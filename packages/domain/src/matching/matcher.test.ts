import {describe, expect, it} from 'vitest';
import {hoursAgo, makeOrder, makeSettlement} from '../test-support/snapshot.js';
import {matchSettlement} from './matcher.js';

const BASE = {
    settlement: makeSettlement(),
    chargeMetadata: {},
    paymentIntentId: null,
    customerEmail: 'buyer@example.com',
    heuristicWindowSeconds: 7_200,
    autoAcceptConfidence: 0.6,
};

describe('matchSettlement', () => {
    it('takes metadata.order_id as an exact match at full confidence', () => {
        const order = makeOrder();
        const result = matchSettlement({...BASE, chargeMetadata: {order_id: 'ORD-1001'}, orders: [order]});
        expect(result.match.tier).toBe('exact');
        expect(result.match.confidence).toBe(1);
        expect(result.match.orderId).toBe(order.id);
    });

    it('falls back to the payment intent stored on the order as a strong match', () => {
        const order = makeOrder();
        const result = matchSettlement({...BASE, paymentIntentId: 'pi_1', orders: [order]});
        expect(result.match.tier).toBe('strong');
        expect(result.match.confidence).toBe(0.95);
    });

    it('scores a heuristic match from amount, window and email', () => {
        const order = makeOrder({paymentIntentId: null, placedAt: hoursAgo(48.2)});
        const result = matchSettlement({...BASE, orders: [order]});
        expect(result.match.tier).toBe('heuristic');
        expect(result.match.confidence).toBeGreaterThan(0.6);
        expect(result.match.confidence).toBeLessThanOrEqual(0.85);
    });

    it('reports ambiguity rather than picking arbitrarily between equal candidates', () => {
        const a = makeOrder({
            id: 'aaaaaaaa-1111-4111-8111-111111111111',
            externalOrderId: 'ORD-A',
            paymentIntentId: null,
            placedAt: hoursAgo(48.2)
        });
        const b = makeOrder({
            id: 'bbbbbbbb-1111-4111-8111-111111111111',
            externalOrderId: 'ORD-B',
            paymentIntentId: null,
            placedAt: hoursAgo(48.2)
        });
        const result = matchSettlement({...BASE, orders: [a, b]});
        expect(result.ambiguous).toBe(true);
        expect(result.match.orderId).toBeNull();
        expect(result.match.method).toBe('heuristic:ambiguous');
        expect(result.candidates).toHaveLength(2);
    });

    it('leaves a payment unmatched when nothing clears the threshold', () => {
        const result = matchSettlement({...BASE, orders: [makeOrder({totalMinor: 55_555n, paymentIntentId: null})]});
        expect(result.match.tier).toBe('unmatched');
        expect(result.match.orderId).toBeNull();
    });

    it('never matches across currencies', () => {
        const order = makeOrder({currency: 'EUR', paymentIntentId: null});
        const result = matchSettlement({...BASE, orders: [order]});
        expect(result.match.tier).toBe('unmatched');
    });

    it('ignores cancelled orders as candidates', () => {
        const order = makeOrder({status: 'cancelled', paymentIntentId: null});
        const result = matchSettlement({...BASE, orders: [order]});
        expect(result.match.tier).toBe('unmatched');
    });
});
