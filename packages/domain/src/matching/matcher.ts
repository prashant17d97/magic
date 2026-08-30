import type {MatchTier} from '@magic/contracts';
import type {MatchSnapshot, OrderSnapshot, SettlementSnapshot} from '../ledger/types.js';

export interface MatchCandidate {
    readonly orderId: string;
    readonly externalOrderId: string;
    readonly confidence: number;
    readonly reason: string;
}

export interface MatchResult {
    readonly match: MatchSnapshot;
    readonly candidates: readonly MatchCandidate[];
    readonly ambiguous: boolean;
}

export interface MatchInput {
    readonly settlement: SettlementSnapshot;
    readonly chargeMetadata: Readonly<Record<string, string>>;
    readonly paymentIntentId: string | null;
    readonly customerEmail: string | null;
    readonly orders: readonly OrderSnapshot[];
    readonly heuristicWindowSeconds: number;
    readonly autoAcceptConfidence: number;
}

const TIER_CONFIDENCE: Record<MatchTier, number> = {
    exact: 1.0,
    strong: 0.95,
    heuristic: 0.6,
    unmatched: 0,
};

/**
 * Matching is tiered and the tier is persisted alongside the pairing, so an operator reading a
 * finding always knows how the payment and the order were connected. A payment with more than
 * one plausible candidate is reported as ambiguous rather than resolved by an arbitrary pick —
 * an arbitrary pick is a wrong answer that looks like a right one.
 */
export function matchSettlement(input: MatchInput): MatchResult {
    const {settlement, orders} = input;

    const explicitOrderId = input.chargeMetadata['order_id'];
    if (explicitOrderId) {
        const order = orders.find((o) => o.externalOrderId === explicitOrderId);
        if (order) {
            return {
                match: {
                    settlementChargeId: settlement.chargeId,
                    orderId: order.id,
                    tier: 'exact',
                    confidence: TIER_CONFIDENCE.exact,
                    method: 'metadata.order_id',
                },
                candidates: [
                    {
                        orderId: order.id,
                        externalOrderId: order.externalOrderId,
                        confidence: 1,
                        reason: 'metadata.order_id'
                    },
                ],
                ambiguous: false,
            };
        }
    }

    if (input.paymentIntentId) {
        const order = orders.find((o) => o.paymentIntentId === input.paymentIntentId);
        if (order) {
            return {
                match: {
                    settlementChargeId: settlement.chargeId,
                    orderId: order.id,
                    tier: 'strong',
                    confidence: TIER_CONFIDENCE.strong,
                    method: 'order.payment_intent_id',
                },
                candidates: [
                    {
                        orderId: order.id,
                        externalOrderId: order.externalOrderId,
                        confidence: TIER_CONFIDENCE.strong,
                        reason: 'order.payment_intent_id',
                    },
                ],
                ambiguous: false,
            };
        }
    }

    const candidates = heuristicCandidates(input).sort(
        (a, b) => b.confidence - a.confidence || (a.orderId < b.orderId ? -1 : 1),
    );

    const best = candidates[0];
    if (!best || best.confidence < input.autoAcceptConfidence) {
        return {
            match: {
                settlementChargeId: settlement.chargeId,
                orderId: null,
                tier: 'unmatched',
                confidence: 0,
                method: candidates.length > 0 ? 'heuristic:below_threshold' : 'heuristic:no_candidate',
            },
            candidates,
            ambiguous: false,
        };
    }

    const runnerUp = candidates[1];
    const ambiguous = runnerUp !== undefined && Math.abs(runnerUp.confidence - best.confidence) < 0.05;

    return {
        match: {
            settlementChargeId: settlement.chargeId,
            orderId: ambiguous ? null : best.orderId,
            tier: ambiguous ? 'unmatched' : 'heuristic',
            confidence: ambiguous ? 0 : best.confidence,
            method: ambiguous ? 'heuristic:ambiguous' : 'amount+email+window',
        },
        candidates,
        ambiguous,
    };
}

/**
 * Confidence is built from independent signals rather than a single fuzzy score, so an operator
 * reading the evidence can see which signals agreed and which did not.
 */
function heuristicCandidates(input: MatchInput): MatchCandidate[] {
    const {settlement, orders} = input;
    const chargedAt = Date.parse(settlement.chargedAt);
    const windowMs = input.heuristicWindowSeconds * 1000;
    const results: MatchCandidate[] = [];

    for (const order of orders) {
        if (order.status === 'cancelled') continue;
        if (order.currency !== settlement.currency) continue;
        if (order.totalMinor !== settlement.customerGrossMinor) continue;

        const placedAt = Date.parse(order.placedAt);
        if (Math.abs(chargedAt - placedAt) > windowMs) continue;

        let confidence = 0.6;
        const reasons = ['amount', 'window'];

        if (
            input.customerEmail !== null &&
            order.customerEmail !== null &&
            order.customerEmail.toLowerCase() === input.customerEmail.toLowerCase()
        ) {
            confidence += 0.2;
            reasons.push('email');
        }

        if (
            order.merchantAccountId !== null &&
            order.merchantAccountId === settlement.merchantAccountId
        ) {
            confidence += 0.05;
            reasons.push('merchant');
        }

        if (Math.abs(chargedAt - placedAt) <= windowMs / 4) {
            confidence += 0.05;
            reasons.push('tight_window');
        }

        results.push({
            orderId: order.id,
            externalOrderId: order.externalOrderId,
            confidence: Math.min(0.85, Number(confidence.toFixed(2))),
            reason: reasons.join('+'),
        });
    }

    return results;
}
