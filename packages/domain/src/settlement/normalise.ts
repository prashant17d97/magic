import type {SettlementStatus} from '@magic/contracts';
import {Money} from '../money/money.js';
import type {
    AppFeeSnapshot,
    BalanceTxnSnapshot,
    ChargeSnapshot,
    DisputeSnapshot,
    RefundSnapshot,
    ReversalSnapshot,
    SettlementSnapshot,
    TransferSnapshot,
} from '../ledger/types.js';

export interface NormaliseInput {
    readonly charge: ChargeSnapshot;
    readonly platformAccountId: string;
    readonly balanceTransactions: readonly BalanceTxnSnapshot[];
    readonly refunds: readonly RefundSnapshot[];
    readonly transfers: readonly TransferSnapshot[];
    readonly reversals: readonly ReversalSnapshot[];
    readonly applicationFees: readonly AppFeeSnapshot[];
    readonly disputes: readonly DisputeSnapshot[];
}

/**
 * Raised when a mapper produces a settlement that does not balance. This is always our bug,
 * never a finding about the client, so it escalates as an internal alert rather than entering
 * the operator's exception queue.
 */
export class SettlementInvariantError extends Error {
    readonly chargeId: string;
    readonly detail: Record<string, string>;

    constructor(chargeId: string, detail: Record<string, string>) {
        super(`Settlement for ${chargeId} does not balance: gross must equal fee + platform + net + refunded.`);
        this.name = 'SettlementInvariantError';
        this.chargeId = chargeId;
        this.detail = detail;
    }
}

function settlementStatus(
    charge: ChargeSnapshot,
    refundedMinor: bigint,
    disputes: readonly DisputeSnapshot[],
    reversedMinor: bigint,
    settled: boolean,
): SettlementStatus {
    if (disputes.some((d) => d.status !== 'won' && d.status !== 'warning_closed')) return 'disputed';
    if (refundedMinor > 0n && refundedMinor >= charge.amountMinor) return 'refunded';
    if (refundedMinor > 0n) return 'partially_refunded';
    if (reversedMinor > 0n && refundedMinor === 0n) return 'reversed';
    return settled ? 'settled' : 'pending';
}

/**
 * Produces the one normalised shape every layer above this point reads. Charge type is recorded
 * for auditability but is never a branch anywhere downstream — matching, rules, the console and
 * the exports all consume these figures without knowing which Connect flow produced them.
 *
 * The four money figures always satisfy:
 *   customer_gross = processing_fee + platform_revenue + merchant_net + refunded
 */
export function normaliseSettlement(input: NormaliseInput): SettlementSnapshot {
    const {charge, platformAccountId} = input;
    const currency = charge.currency;

    const chargeTxn = input.balanceTransactions.find(
        (b) => b.type === 'charge' && (b.sourceId === charge.id || b.id === charge.balanceTransactionId),
    );

    const gross = Money.of(charge.amountMinor, currency);

    const chargeRefunds = input.refunds.filter((r) => r.chargeId === charge.id);
    const refunded = Money.sum(
        chargeRefunds.filter((r) => r.status !== 'failed' && r.status !== 'canceled').map((r) => Money.of(r.amountMinor, currency)),
        currency,
    );

    const fees = input.applicationFees.filter((f) => f.chargeId === charge.id);
    const platformRevenue = Money.sum(
        fees.map((f) => Money.of(f.amountMinor - f.amountRefundedMinor, currency)),
        currency,
    );

    const relatedTransfers = input.transfers.filter(
        (t) => t.sourceTransaction === charge.id || t.id === charge.transferId,
    );
    const reversedToPlatform = Money.sum(
        input.reversals
            .filter((r) => relatedTransfers.some((t) => t.id === r.transferId))
            .map((r) => Money.of(r.amountMinor, currency)),
        currency,
    );

    const processingFee = chargeTxn
        ? Money.of(chargeTxn.feeMinor, currency)
        : Money.zero(currency);

    const merchantNet = gross.minus(processingFee).minus(platformRevenue).minus(refunded);

    const fundsHolderAccountId =
        charge.chargeType === 'destination' ? platformAccountId : charge.stripeAccountId;
    const merchantAccountId =
        charge.chargeType === 'destination'
            ? (charge.transferDestination ?? charge.onBehalfOf ?? charge.stripeAccountId)
            : charge.stripeAccountId;

    const payoutId = chargeTxn?.payoutId ?? null;
    const disputes = input.disputes.filter((d) => d.chargeId === charge.id);

    const settlement: SettlementSnapshot = {
        chargeId: charge.id,
        chargeType: charge.chargeType,
        fundsHolderAccountId,
        merchantAccountId,
        currency,
        customerGrossMinor: gross.minor,
        processingFeeMinor: processingFee.minor,
        platformRevenueMinor: platformRevenue.minor,
        merchantNetMinor: merchantNet.minor,
        refundedMinor: refunded.minor,
        reversedToPlatformMinor: reversedToPlatform.minor,
        settlementStatus: settlementStatus(charge, refunded.minor, disputes, reversedToPlatform.minor, payoutId !== null),
        payoutId,
        chargedAt: charge.createdAt,
    };

    assertSettlementBalances(settlement);
    return settlement;
}

export function assertSettlementBalances(settlement: SettlementSnapshot): void {
    const reconstructed =
        settlement.processingFeeMinor +
        settlement.platformRevenueMinor +
        settlement.merchantNetMinor +
        settlement.refundedMinor;

    if (reconstructed !== settlement.customerGrossMinor) {
        throw new SettlementInvariantError(settlement.chargeId, {
            customer_gross: settlement.customerGrossMinor.toString(),
            processing_fee: settlement.processingFeeMinor.toString(),
            platform_revenue: settlement.platformRevenueMinor.toString(),
            merchant_net: settlement.merchantNetMinor.toString(),
            refunded: settlement.refundedMinor.toString(),
            reconstructed: reconstructed.toString(),
        });
    }
}
