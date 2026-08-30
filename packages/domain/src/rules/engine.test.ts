import {describe, expect, it} from 'vitest';
import {
    hoursAgo,
    makeBalanceTxn,
    makeCharge,
    makeOrder,
    makePayout,
    makeSettlement,
    makeSnapshot,
    MERCHANT,
} from '../test-support/snapshot.js';
import {evaluate} from './engine.js';
import {ALL_RULES, ruleSetChecksum} from './registry.js';
import type {RuleSettings} from './types.js';

const NO_OVERRIDES = new Map<string, RuleSettings>();
const OPTIONS = {ruleVersion: 1, settings: NO_OVERRIDES};

describe('rule engine', () => {
    it('reports a balanced payout as clean', () => {
        const result = evaluate(makeSnapshot(), OPTIONS);
        expect(result.findings.filter((f) => f.ruleId === 'L1.PAYOUT.CHECKSUM')).toHaveLength(0);
    });

    it('raises a critical checksum finding when a payout does not decompose', () => {
        const result = evaluate(
            makeSnapshot({payout: makePayout({amountMinor: 10_000n})}),
            OPTIONS,
        );
        const finding = result.findings.find((f) => f.ruleId === 'L1.PAYOUT.CHECKSUM');
        expect(finding?.severity).toBe('critical');
        expect(finding?.exposureMinor).toBe(320n);
        expect(finding?.narrative).toContain('-3.20 USD');
    });

    it('suppresses payout checks on an account whose payouts are paused', () => {
        const result = evaluate(
            makeSnapshot({payoutsEnabled: false, payout: makePayout({amountMinor: 10_000n})}),
            OPTIONS,
        );
        expect(result.findings.some((f) => f.ruleId === 'L1.PAYOUT.CHECKSUM')).toBe(false);
        expect(result.rulesSuppressed.map((s) => s.ruleId)).toContain('L1.PAYOUT.CHECKSUM');
    });

    it('flags a destination charge whose merchant transfer never happened', () => {
        const result = evaluate(
            makeSnapshot({
                charges: [makeCharge({transferDestination: MERCHANT, transferDataAmountMinor: 9_000n})],
            }),
            OPTIONS,
        );
        const finding = result.findings.find((f) => f.ruleId === 'L2.DEST.TRANSFER_MISSING');
        expect(finding?.exposureMinor).toBe(9_000n);
    });

    it('holds a fresh destination charge inside its maturity window', () => {
        const result = evaluate(
            makeSnapshot({
                charges: [
                    makeCharge({
                        transferDestination: MERCHANT,
                        transferDataAmountMinor: 9_000n,
                        createdAt: hoursAgo(1),
                    }),
                ],
            }),
            OPTIONS,
        );
        expect(result.findings.some((f) => f.ruleId === 'L2.DEST.TRANSFER_MISSING')).toBe(false);
    });

    it('finds a refund the platform absorbed because the transfer was never reversed', () => {
        const result = evaluate(
            makeSnapshot({
                charges: [makeCharge({transferDestination: MERCHANT, transferId: 'tr_1'})],
                transfers: [
                    {
                        id: 'tr_1',
                        destinationAccountId: MERCHANT,
                        amountMinor: 9_000n,
                        amountReversedMinor: 0n,
                        currency: 'USD',
                        sourceTransaction: 'ch_1',
                        createdAt: hoursAgo(47),
                    },
                ],
                refunds: [
                    {
                        id: 're_1',
                        chargeId: 'ch_1',
                        amountMinor: 10_000n,
                        currency: 'USD',
                        status: 'succeeded',
                        reason: 'requested_by_customer',
                        transferReversalId: null,
                        createdAt: hoursAgo(30),
                    },
                ],
            }),
            OPTIONS,
        );
        const finding = result.findings.find((f) => f.ruleId === 'L2.DEST.REFUND_NO_REVERSAL');
        expect(finding?.severity).toBe('critical');
        expect(finding?.exposureMinor).toBe(10_000n);
    });

    it('does not stack layer 2 and 3 findings on a subject that already failed layer 1', () => {
        const brokenCharge = makeCharge({chargeType: 'unclassified', chargeTypeConfidence: 0});
        const result = evaluate(
            makeSnapshot({
                charges: [brokenCharge],
                settlements: [makeSettlement()],
            }),
            OPTIONS,
        );
        const forCharge = result.findings.filter((f) => f.subjectId === 'ch_1');
        expect(forCharge).toHaveLength(1);
        expect(forCharge[0]?.layer).toBe(1);
    });

    it('flags a payment with no order once the order window has data to compare against', () => {
        const result = evaluate(
            makeSnapshot({
                settlements: [makeSettlement()],
                orders: [makeOrder({ id: 'cccccccc-1111-4111-8111-111111111111', externalOrderId: 'ORD-OTHER', totalMinor: 999n })],
                matches: [],
            }),
            OPTIONS,
        );
        expect(result.findings.some((f) => f.ruleId === 'L3.ORDER.PAYMENT_UNMATCHED')).toBe(true);
    });

    it('stays silent about unmatched payments when the order source returned nothing at all', () => {
        const result = evaluate(makeSnapshot({ settlements: [makeSettlement()], orders: [], matches: [] }), OPTIONS);
        expect(result.findings.some((f) => f.ruleId === 'L3.ORDER.PAYMENT_UNMATCHED')).toBe(false);
    });

    it('flags one order paid twice as critical', () => {
        const order = makeOrder();
        const result = evaluate(
            makeSnapshot({
                orders: [order],
                settlements: [makeSettlement(), makeSettlement({chargeId: 'ch_2'})],
                matches: [
                    {
                        settlementChargeId: 'ch_1',
                        orderId: order.id,
                        tier: 'exact',
                        confidence: 1,
                        method: 'metadata.order_id'
                    },
                    {
                        settlementChargeId: 'ch_2',
                        orderId: order.id,
                        tier: 'exact',
                        confidence: 1,
                        method: 'metadata.order_id'
                    },
                ],
            }),
            OPTIONS,
        );
        const finding = result.findings.find((f) => f.ruleId === 'L3.ORDER.DUPLICATE_PAYMENT');
        expect(finding?.severity).toBe('critical');
        expect(finding?.exposureMinor).toBe(10_000n);
    });

    it('honours a tenant disabling a rule', () => {
        const settings = new Map<string, RuleSettings>([
            ['L1.PAYOUT.CHECKSUM', {enabled: false, severity: 'critical', maturitySeconds: 0, parameters: {}}],
        ]);
        const result = evaluate(makeSnapshot({payout: makePayout({amountMinor: 1n})}), {
            ruleVersion: 1,
            settings,
        });
        expect(result.findings.some((f) => f.ruleId === 'L1.PAYOUT.CHECKSUM')).toBe(false);
    });

    it('honours a tenant widening a tolerance parameter', () => {
        const settings = new Map<string, RuleSettings>([
            [
                'L1.PAYOUT.CHECKSUM',
                {enabled: true, severity: 'critical', maturitySeconds: 0, parameters: {tolerance_minor: 500}},
            ],
        ]);
        const result = evaluate(makeSnapshot({payout: makePayout({amountMinor: 10_000n})}), {
            ruleVersion: 1,
            settings,
        });
        expect(result.findings.some((f) => f.ruleId === 'L1.PAYOUT.CHECKSUM')).toBe(false);
    });

    it('only runs aggregate rules in an aggregate run', () => {
        const transactional = evaluate(makeSnapshot({mode: 'transactional'}), OPTIONS);
        expect(transactional.rulesEvaluated).not.toContain('L2.SEP.TRANSFER_AGGREGATE');

        const aggregate = evaluate(makeSnapshot({mode: 'aggregate'}), OPTIONS);
        expect(aggregate.rulesEvaluated).toContain('L2.SEP.TRANSFER_AGGREGATE');
    });

    it('reconciles separate transfers in aggregate when per-charge links are absent', () => {
        const result = evaluate(
            makeSnapshot({
                mode: 'aggregate',
                settlements: [makeSettlement({chargeType: 'separate', merchantNetMinor: 8_680n})],
                transfers: [
                    {
                        id: 'tr_9',
                        destinationAccountId: MERCHANT,
                        amountMinor: 8_000n,
                        amountReversedMinor: 0n,
                        currency: 'USD',
                        sourceTransaction: null,
                        createdAt: hoursAgo(20),
                    },
                ],
            }),
            OPTIONS,
        );
        const finding = result.findings.find((f) => f.ruleId === 'L2.SEP.TRANSFER_AGGREGATE');
        expect(finding?.exposureMinor).toBe(680n);
    });
});

describe('determinism', () => {
    it('produces byte-identical findings across a double run', () => {
        const snapshot = makeSnapshot({
            payout: makePayout({amountMinor: 10_000n}),
            charges: [makeCharge({transferDestination: MERCHANT, transferDataAmountMinor: 9_000n})],
            balanceTransactions: [makeBalanceTxn(), makeBalanceTxn({id: 'txn_2', sourceId: 'ch_2'})],
            settlements: [makeSettlement()],
            orders: [makeOrder()],
        });

        const first = JSON.stringify(evaluate(snapshot, OPTIONS).findings, bigintReplacer);
        const second = JSON.stringify(evaluate(snapshot, OPTIONS).findings, bigintReplacer);
        expect(first).toBe(second);
    });

    it('keeps the registry checksum stable for an unchanged rule set', () => {
        expect(ruleSetChecksum()).toBe(ruleSetChecksum());
        expect(ruleSetChecksum()).toHaveLength(64);
    });

    it('gives every rule a unique id, a narrative and a maturity window', () => {
        const ids = ALL_RULES.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const rule of ALL_RULES) {
            expect(rule.maturitySeconds).toBeGreaterThanOrEqual(0);
            expect(rule.name.length).toBeGreaterThan(3);
            expect(rule.description.length).toBeGreaterThan(10);
        }
    });
});

function bigintReplacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}
