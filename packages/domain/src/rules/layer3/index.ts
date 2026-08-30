import {abs, Money} from '../../money/money.js';
import type {Finding} from '../../ledger/types.js';
import {ageSeconds, bigintParam, numberParam, type Rule} from '../types.js';

/**
 * Layer 3 reads `settlements` and `orders`. It has no access to charge type as a branch — that is
 * the entire point of the settlement boundary. If a rule here ever needs to know whether a charge
 * was direct or destination, the normalisation above it is wrong.
 */

export const PaymentWithoutOrderRule: Rule = {
    id: 'L3.ORDER.PAYMENT_UNMATCHED',
    name: 'Payment without an order',
    description: 'Every settled payment should correspond to an order in the order source.',
    layer: 3,
    severity: 'high',
    maturitySeconds: 86_400,
    mode: 'both',
    defaultParameters: {minimum_exposure_minor: 100},

    evaluate(snapshot, params) {
        if (snapshot.orders.length === 0) return [];

        const minimum = bigintParam(params, 'minimum_exposure_minor', 100n);
        const matchByCharge = new Map(snapshot.matches.map((m) => [m.settlementChargeId, m]));
        const findings: Finding[] = [];

        for (const settlement of snapshot.settlements) {
            if (settlement.customerGrossMinor < minimum) continue;
            if (ageSeconds(snapshot.asOf, settlement.chargedAt) < PaymentWithoutOrderRule.maturitySeconds) continue;

            const match = matchByCharge.get(settlement.chargeId);
            if (match && match.tier !== 'unmatched' && match.orderId !== null) continue;

            findings.push({
                ruleId: PaymentWithoutOrderRule.id,
                subjectType: 'settlement',
                subjectId: settlement.chargeId,
                severity: 'high',
                exposureMinor: settlement.customerGrossMinor,
                currency: settlement.currency,
                expected: {matched_order: true},
                actual: {matched_order: false, match_tier: match?.tier ?? 'unmatched'},
                evidence: {
                    charge_id: settlement.chargeId,
                    merchant_account_id: settlement.merchantAccountId,
                    charged_at: settlement.chargedAt,
                    candidates_considered: match?.method ?? 'none',
                },
                narrative: `Payment ${settlement.chargeId} for ${Money.of(settlement.customerGrossMinor, settlement.currency).format()} has no matching order. Either the order source is behind or the payment does not belong here.`,
            });
        }

        return findings;
    },
};

export const OrderWithoutPaymentRule: Rule = {
    id: 'L3.ORDER.NEVER_PAID',
    name: 'Order never paid',
    description: 'An order that has stayed unpaid past its maturity window has no settlement behind it.',
    layer: 3,
    severity: 'medium',
    maturitySeconds: 86_400,
    mode: 'both',
    defaultParameters: {},

    evaluate(snapshot) {
        const matchedOrderIds = new Set(snapshot.matches.map((m) => m.orderId).filter((id): id is string => id !== null));

        return snapshot.orders
            .filter((o) => o.status !== 'cancelled' && o.status !== 'refunded')
            .filter((o) => !matchedOrderIds.has(o.id))
            .filter((o) => o.cancelledAt === null)
            .filter((o) => ageSeconds(snapshot.asOf, o.placedAt) >= OrderWithoutPaymentRule.maturitySeconds)
            .sort((a, b) => (a.id < b.id ? -1 : 1))
            .map((order) => ({
                ruleId: OrderWithoutPaymentRule.id,
                subjectType: 'order' as const,
                subjectId: order.externalOrderId,
                severity: 'medium' as const,
                exposureMinor: order.totalMinor,
                currency: order.currency,
                expected: {settlement_present: true},
                actual: {settlement_present: false, order_status: order.status},
                evidence: {
                    order_id: order.id,
                    external_order_id: order.externalOrderId,
                    placed_at: order.placedAt,
                    payment_intent_id: order.paymentIntentId,
                },
                narrative: `Order ${order.externalOrderId} for ${Money.of(order.totalMinor, order.currency).format()} was placed but never paid. It has been open past the maturity window.`,
            }));
    },
};

export const AmountMismatchRule: Rule = {
    id: 'L3.ORDER.AMOUNT_MISMATCH',
    name: 'Order and payment amounts disagree',
    description: 'A matched order and its settlement must agree on the amount the customer paid.',
    layer: 3,
    severity: 'high',
    maturitySeconds: 3_600,
    mode: 'both',
    defaultParameters: {tolerance_minor: 0},

    evaluate(snapshot, params) {
        const tolerance = bigintParam(params, 'tolerance_minor', 0n);
        const ordersById = new Map(snapshot.orders.map((o) => [o.id, o]));
        const settlementsByCharge = new Map(snapshot.settlements.map((s) => [s.chargeId, s]));
        const findings: Finding[] = [];

        for (const match of snapshot.matches) {
            if (match.orderId === null || match.tier === 'unmatched') continue;
            const order = ordersById.get(match.orderId);
            const settlement = settlementsByCharge.get(match.settlementChargeId);
            if (!order || !settlement) continue;
            if (order.currency !== settlement.currency) continue;
            if (ageSeconds(snapshot.asOf, settlement.chargedAt) < AmountMismatchRule.maturitySeconds) continue;

            const paid = Money.of(settlement.customerGrossMinor, settlement.currency);
            const ordered = Money.of(order.totalMinor, order.currency);
            const delta = paid.minus(ordered);
            if (abs(delta.minor) <= tolerance) continue;

            findings.push({
                ruleId: AmountMismatchRule.id,
                subjectType: 'settlement',
                subjectId: settlement.chargeId,
                severity: 'high',
                exposureMinor: abs(delta.minor),
                currency: settlement.currency,
                expected: {order_total_minor: ordered.toMinorString(), external_order_id: order.externalOrderId},
                actual: {paid_minor: paid.toMinorString(), delta_minor: delta.toMinorString()},
                evidence: {
                    charge_id: settlement.chargeId,
                    order_id: order.id,
                    match_tier: match.tier,
                    match_confidence: match.confidence,
                },
                narrative: `Order ${order.externalOrderId} is for ${ordered.format()} but the customer paid ${paid.format()}. Difference: ${delta.format()}.`,
            });
        }

        return findings;
    },
};

export const DuplicatePaymentRule: Rule = {
    id: 'L3.ORDER.DUPLICATE_PAYMENT',
    name: 'Duplicate payment for one order',
    description: 'One order matched by more than one settlement means the customer was charged twice.',
    layer: 3,
    severity: 'critical',
    maturitySeconds: 3_600,
    mode: 'both',
    defaultParameters: {},

    evaluate(snapshot) {
        const byOrder = new Map<string, string[]>();
        for (const match of snapshot.matches) {
            if (match.orderId === null || match.tier === 'unmatched') continue;
            const existing = byOrder.get(match.orderId) ?? [];
            existing.push(match.settlementChargeId);
            byOrder.set(match.orderId, existing);
        }

        const ordersById = new Map(snapshot.orders.map((o) => [o.id, o]));
        const settlementsByCharge = new Map(snapshot.settlements.map((s) => [s.chargeId, s]));
        const findings: Finding[] = [];

        for (const [orderId, chargeIds] of [...byOrder.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
            if (chargeIds.length < 2) continue;
            const order = ordersById.get(orderId);
            if (!order) continue;

            const sorted = [...chargeIds].sort();
            const duplicated = Money.sum(
                sorted
                    .slice(1)
                    .map((id) => settlementsByCharge.get(id))
                    .filter((s) => s !== undefined)
                    .map((s) => Money.of(s.customerGrossMinor, s.currency)),
                order.currency,
            );

            findings.push({
                ruleId: DuplicatePaymentRule.id,
                subjectType: 'order',
                subjectId: order.externalOrderId,
                severity: 'critical',
                exposureMinor: duplicated.minor,
                currency: order.currency,
                expected: {settlement_count: 1},
                actual: {settlement_count: sorted.length, charge_ids: sorted},
                evidence: {order_id: order.id, external_order_id: order.externalOrderId, charge_ids: sorted},
                narrative: `Order ${order.externalOrderId} is matched by ${sorted.length} payments. ${duplicated.format()} appears to have been charged more than once.`,
            });
        }

        return findings;
    },
};

export const ShippedThenRefundedRule: Rule = {
    id: 'L3.ORDER.SHIPPED_THEN_REFUNDED',
    name: 'Fulfilled order fully refunded',
    description: 'An order that shipped and was then fully refunded is goods gone and money returned.',
    layer: 3,
    severity: 'high',
    maturitySeconds: 43_200,
    mode: 'both',
    defaultParameters: {minimum_exposure_minor: 500},

    evaluate(snapshot, params) {
        const minimum = bigintParam(params, 'minimum_exposure_minor', 500n);
        const ordersById = new Map(snapshot.orders.map((o) => [o.id, o]));
        const settlementsByCharge = new Map(snapshot.settlements.map((s) => [s.chargeId, s]));
        const findings: Finding[] = [];

        for (const match of snapshot.matches) {
            if (match.orderId === null) continue;
            const order = ordersById.get(match.orderId);
            const settlement = settlementsByCharge.get(match.settlementChargeId);
            if (!order || !settlement) continue;
            if (order.fulfillmentStatus !== 'fulfilled' && order.fulfilledAt === null) continue;
            if (settlement.settlementStatus !== 'refunded') continue;
            if (settlement.refundedMinor < minimum) continue;
            if (ageSeconds(snapshot.asOf, settlement.chargedAt) < ShippedThenRefundedRule.maturitySeconds) continue;

            findings.push({
                ruleId: ShippedThenRefundedRule.id,
                subjectType: 'order',
                subjectId: order.externalOrderId,
                severity: 'high',
                exposureMinor: settlement.refundedMinor,
                currency: settlement.currency,
                expected: {refund_after_fulfilment: false},
                actual: {
                    fulfilled_at: order.fulfilledAt,
                    refunded_minor: settlement.refundedMinor.toString(),
                },
                evidence: {
                    order_id: order.id,
                    external_order_id: order.externalOrderId,
                    charge_id: settlement.chargeId,
                    fulfillment_status: order.fulfillmentStatus,
                },
                narrative: `Order ${order.externalOrderId} was fulfilled and then fully refunded ${Money.of(settlement.refundedMinor, settlement.currency).format()}. Goods left and the money went back.`,
            });
        }

        return findings;
    },
};

export const AmbiguousMatchRule: Rule = {
    id: 'L3.MATCH.AMBIGUOUS',
    name: 'Ambiguous order match',
    description: 'A payment with more than one plausible order candidate must be resolved by a human.',
    layer: 3,
    severity: 'medium',
    maturitySeconds: 3_600,
    mode: 'both',
    defaultParameters: {max_confidence: 0.85},

    evaluate(snapshot, params) {
        const maxConfidence = numberParam(params, 'max_confidence', 0.85);
        const settlementsByCharge = new Map(snapshot.settlements.map((s) => [s.chargeId, s]));

        return snapshot.matches
            .filter((m) => m.tier === 'heuristic' && m.confidence < maxConfidence)
            .sort((a, b) => (a.settlementChargeId < b.settlementChargeId ? -1 : 1))
            .map((match) => {
                const settlement = settlementsByCharge.get(match.settlementChargeId);
                return {
                    ruleId: AmbiguousMatchRule.id,
                    subjectType: 'settlement' as const,
                    subjectId: match.settlementChargeId,
                    severity: 'medium' as const,
                    exposureMinor: settlement?.customerGrossMinor ?? null,
                    currency: settlement?.currency ?? null,
                    expected: {match_confidence_at_least: maxConfidence},
                    actual: {match_confidence: match.confidence, tier: match.tier, method: match.method},
                    evidence: {
                        charge_id: match.settlementChargeId,
                        order_id: match.orderId,
                        method: match.method,
                    },
                    narrative: `Payment ${match.settlementChargeId} was matched heuristically at ${match.confidence} confidence via ${match.method}. Verify the pairing before relying on it.`,
                };
            });
    },
};

export const LAYER_3_RULES: readonly Rule[] = [
    PaymentWithoutOrderRule,
    OrderWithoutPaymentRule,
    AmountMismatchRule,
    DuplicatePaymentRule,
    ShippedThenRefundedRule,
    AmbiguousMatchRule,
];
