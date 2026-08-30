import {describe, expect, it} from 'vitest';
import type {ChargeSnapshot} from '../ledger/types.js';
import {assertSettlementBalances, normaliseSettlement, SettlementInvariantError} from './normalise.js';

const PLATFORM = 'acct_platform';
const MERCHANT = 'acct_merchant';

function charge(overrides: Partial<ChargeSnapshot> = {}): ChargeSnapshot {
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
        createdAt: '2026-08-20T10:00:00.000Z',
        ...overrides,
    };
}

const chargeTxn = {
    id: 'txn_1',
    stripeAccountId: PLATFORM,
    type: 'charge',
    sourceId: 'ch_1',
    grossMinor: 10_000n,
    feeMinor: 320n,
    netMinor: 9_680n,
    currency: 'USD',
    payoutId: 'po_1',
    createdAt: '2026-08-20T10:00:00.000Z',
};

const emptyInput = {
    platformAccountId: PLATFORM,
    balanceTransactions: [chargeTxn],
    refunds: [],
    transfers: [],
    reversals: [],
    applicationFees: [],
    disputes: [],
};

describe('normaliseSettlement', () => {
    it('produces one balanced shape for a destination charge', () => {
        const result = normaliseSettlement({
            ...emptyInput,
            charge: charge({transferDestination: MERCHANT, transferId: 'tr_1'}),
            applicationFees: [
                {
                    id: 'fee_1',
                    chargeId: 'ch_1',
                    originatingAccountId: MERCHANT,
                    amountMinor: 1_000n,
                    amountRefundedMinor: 0n,
                    currency: 'USD',
                    refunded: false,
                    createdAt: '2026-08-20T10:00:00.000Z',
                },
            ],
        });

        expect(result.customerGrossMinor).toBe(10_000n);
        expect(result.processingFeeMinor).toBe(320n);
        expect(result.platformRevenueMinor).toBe(1_000n);
        expect(result.merchantNetMinor).toBe(8_680n);
        expect(result.fundsHolderAccountId).toBe(PLATFORM);
        expect(result.merchantAccountId).toBe(MERCHANT);
        expect(result.settlementStatus).toBe('settled');
    });

    it('puts a direct charge on the connected account ledger', () => {
        const result = normaliseSettlement({
            ...emptyInput,
            balanceTransactions: [{...chargeTxn, stripeAccountId: MERCHANT}],
            charge: charge({stripeAccountId: MERCHANT, chargeType: 'direct'}),
        });
        expect(result.fundsHolderAccountId).toBe(MERCHANT);
        expect(result.merchantAccountId).toBe(MERCHANT);
    });

    it('marks a fully refunded charge and keeps the invariant', () => {
        const result = normaliseSettlement({
            ...emptyInput,
            charge: charge({transferDestination: MERCHANT}),
            refunds: [
                {
                    id: 're_1',
                    chargeId: 'ch_1',
                    amountMinor: 10_000n,
                    currency: 'USD',
                    status: 'succeeded',
                    reason: 'requested_by_customer',
                    transferReversalId: 'trr_1',
                    createdAt: '2026-08-21T10:00:00.000Z',
                },
            ],
        });
        expect(result.settlementStatus).toBe('refunded');
        expect(result.refundedMinor).toBe(10_000n);
        expect(() => assertSettlementBalances(result)).not.toThrow();
    });

    it('reports a partial refund distinctly from a full one', () => {
        const result = normaliseSettlement({
            ...emptyInput,
            charge: charge({transferDestination: MERCHANT}),
            refunds: [
                {
                    id: 're_1',
                    chargeId: 'ch_1',
                    amountMinor: 2_500n,
                    currency: 'USD',
                    status: 'succeeded',
                    reason: null,
                    transferReversalId: null,
                    createdAt: '2026-08-21T10:00:00.000Z',
                },
            ],
        });
        expect(result.settlementStatus).toBe('partially_refunded');
    });

    it('flags an open dispute above every other status', () => {
        const result = normaliseSettlement({
            ...emptyInput,
            charge: charge({transferDestination: MERCHANT}),
            disputes: [
                {
                    id: 'dp_1',
                    chargeId: 'ch_1',
                    amountMinor: 10_000n,
                    currency: 'USD',
                    status: 'needs_response',
                    reason: 'fraudulent',
                    createdAt: '2026-08-22T10:00:00.000Z',
                },
            ],
        });
        expect(result.settlementStatus).toBe('disputed');
    });

    it('treats an unbalanced settlement as our bug, not a client finding', () => {
        expect(() =>
            assertSettlementBalances({
                chargeId: 'ch_broken',
                chargeType: 'direct',
                fundsHolderAccountId: MERCHANT,
                merchantAccountId: MERCHANT,
                currency: 'USD',
                customerGrossMinor: 10_000n,
                processingFeeMinor: 300n,
                platformRevenueMinor: 1_000n,
                merchantNetMinor: 8_000n,
                refundedMinor: 0n,
                reversedToPlatformMinor: 0n,
                settlementStatus: 'settled',
                payoutId: null,
                chargedAt: '2026-08-20T10:00:00.000Z',
            }),
        ).toThrow(SettlementInvariantError);
    });
});
