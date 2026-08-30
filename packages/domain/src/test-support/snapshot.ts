import {checksumOf} from '../rules/checksum.js';
import type {
    AppFeeSnapshot,
    BalanceTxnSnapshot,
    ChargeSnapshot,
    DisputeSnapshot,
    MatchSnapshot,
    OrderSnapshot,
    PayoutSnapshot,
    ReconSnapshot,
    RefundSnapshot,
    ReversalSnapshot,
    SettlementSnapshot,
    TransferSnapshot,
} from '../ledger/types.js';

export const PLATFORM = 'acct_platform';
export const MERCHANT = 'acct_merchant';
export const NOW = '2026-08-29T12:00:00.000Z';

/** Shifts a timestamp backwards from the fixed snapshot instant, so tests never touch a clock. */
export function hoursAgo(hours: number, from: string = NOW): string {
    return new Date(Date.parse(from) - hours * 3_600_000).toISOString();
}

export function makeCharge(overrides: Partial<ChargeSnapshot> = {}): ChargeSnapshot {
    return {
        id: 'ch_1',
        stripeAccountId: PLATFORM,
        paymentIntentId: 'pi_1',
        balanceTransactionId: 'txn_1',
        amountMinor: 10_000n,
        currency: 'USD',
        amountRefundedMinor: 0n,
        amountCapturedMinor: 10_000n,
        status: 'succeeded',
        paid: true,
        refunded: false,
        disputed: false,
        captured: true,
        onBehalfOf: null,
        transferDestination: null,
        transferDataAmountMinor: null,
        transferId: null,
        applicationFeeId: null,
        sourceTransferId: null,
        chargeType: 'destination',
        chargeTypeConfidence: 1,
        customerEmail: 'buyer@example.com',
        metadata: {},
        createdAt: hoursAgo(48),
        ...overrides,
    };
}

export function makeBalanceTxn(overrides: Partial<BalanceTxnSnapshot> = {}): BalanceTxnSnapshot {
    return {
        id: 'txn_1',
        stripeAccountId: PLATFORM,
        type: 'charge',
        sourceId: 'ch_1',
        grossMinor: 10_000n,
        feeMinor: 320n,
        netMinor: 9_680n,
        currency: 'USD',
        payoutId: 'po_1',
        createdAt: hoursAgo(48),
        ...overrides,
    };
}

export function makePayout(overrides: Partial<PayoutSnapshot> = {}): PayoutSnapshot {
    return {
        id: 'po_1',
        stripeAccountId: PLATFORM,
        amountMinor: 9_680n,
        currency: 'USD',
        status: 'paid',
        arrivalDate: '2026-08-28',
        createdAt: hoursAgo(24),
        balanceTransactionId: 'txn_payout_1',
        ...overrides,
    };
}

export function makeSettlement(overrides: Partial<SettlementSnapshot> = {}): SettlementSnapshot {
    return {
        chargeId: 'ch_1',
        chargeType: 'destination',
        fundsHolderAccountId: PLATFORM,
        merchantAccountId: MERCHANT,
        currency: 'USD',
        customerGrossMinor: 10_000n,
        processingFeeMinor: 320n,
        platformRevenueMinor: 1_000n,
        merchantNetMinor: 8_680n,
        refundedMinor: 0n,
        reversedToPlatformMinor: 0n,
        settlementStatus: 'settled',
        payoutId: 'po_1',
        chargedAt: hoursAgo(48),
        ...overrides,
    };
}

export function makeOrder(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
    return {
        id: '11111111-1111-4111-8111-111111111111',
        externalOrderId: 'ORD-1001',
        merchantAccountId: MERCHANT,
        totalMinor: 10_000n,
        currency: 'USD',
        expectedPlatformFeeMinor: 1_000n,
        status: 'paid',
        fulfillmentStatus: 'fulfilled',
        customerEmail: 'buyer@example.com',
        paymentIntentId: 'pi_1',
        placedAt: hoursAgo(49),
        fulfilledAt: hoursAgo(24),
        cancelledAt: null,
        ...overrides,
    };
}

export interface SnapshotOverrides {
    mode?: 'transactional' | 'aggregate';
    payoutsEnabled?: boolean;
    chargesEnabled?: boolean;
    payout?: PayoutSnapshot | null;
    charges?: ChargeSnapshot[];
    balanceTransactions?: BalanceTxnSnapshot[];
    refunds?: RefundSnapshot[];
    transfers?: TransferSnapshot[];
    reversals?: ReversalSnapshot[];
    applicationFees?: AppFeeSnapshot[];
    disputes?: DisputeSnapshot[];
    settlements?: SettlementSnapshot[];
    orders?: OrderSnapshot[];
    matches?: MatchSnapshot[];
    stripeAccountId?: string;
}

export function makeSnapshot(overrides: SnapshotOverrides = {}): ReconSnapshot {
    const body = {
        asOf: NOW,
        tenantId: '00000000-0000-4000-8000-000000000001',
        stripeAccountId: overrides.stripeAccountId ?? PLATFORM,
        platformAccountId: PLATFORM,
        scopeKey: 'payout:po_1',
    scopeType: 'platform' as const,
        mode: overrides.mode ?? ('transactional' as const),
        windowStart: hoursAgo(72),
        windowEnd: NOW,
        accountState: {
            stripeAccountId: overrides.stripeAccountId ?? PLATFORM,
            displayName: 'Acme Studio',
            chargesEnabled: overrides.chargesEnabled ?? true,
            payoutsEnabled: overrides.payoutsEnabled ?? true,
            requirementsDisabledReason: null,
            defaultCurrency: 'USD',
        },
        payout: overrides.payout === undefined ? makePayout() : overrides.payout,
        balanceTransactions: overrides.balanceTransactions ?? [makeBalanceTxn()],
        charges: overrides.charges ?? [],
        refunds: overrides.refunds ?? [],
        transfers: overrides.transfers ?? [],
        reversals: overrides.reversals ?? [],
        applicationFees: overrides.applicationFees ?? [],
        disputes: overrides.disputes ?? [],
        settlements: overrides.settlements ?? [],
        orders: overrides.orders ?? [],
        matches: overrides.matches ?? [],
    };

    return {...body, checksum: checksumOf(body)};
}
