import { describe, expect, it } from 'vitest';
import type { NormalisedOrder } from './contract.js';
import { validateOrders } from './contract.js';
import { MockOrderSourceAdapter } from './mock-adapter.js';
import { OrderSourceRegistry } from './registry.js';

function order(id: string, overrides: Partial<NormalisedOrder> = {}): NormalisedOrder {
  return {
    external_order_id: id,
    merchant_account_id: 'acct_merchant',
    total_minor: '10000',
    currency: 'USD',
    expected_platform_fee_minor: '1000',
    status: 'paid',
    fulfillment_status: 'fulfilled',
    customer_email: 'buyer@example.com',
    payment_intent_id: 'pi_1',
    placed_at: '2026-08-20T10:00:00.000Z',
    fulfilled_at: '2026-08-21T10:00:00.000Z',
    cancelled_at: null,
    lines: [],
    shipments: [],
    raw: {},
    ...overrides,
  };
}

describe('order source contract', () => {
  it('rejects an order that violates the contract rather than importing it', () => {
    expect(() => validateOrders([{ external_order_id: '', total_minor: 'abc' }])).toThrow(
      /does not conform to the adapter contract/,
    );
  });

  it('accepts a conforming order', () => {
    expect(validateOrders([order('ORD-1')])).toHaveLength(1);
  });
});

describe('MockOrderSourceAdapter', () => {
  const adapter = new MockOrderSourceAdapter({
    orders: [order('ORD-1'), order('ORD-2'), order('ORD-3')],
  });

  it('pages with a resumable cursor', async () => {
    const first = await adapter.fetchPage({ since: new Date(0), cursor: null, limit: 2 });
    expect(first.orders.map((o) => o.external_order_id)).toEqual(['ORD-1', 'ORD-2']);
    expect(first.nextCursor).toBe('ORD-2');

    const second = await adapter.fetchPage({ since: new Date(0), cursor: first.nextCursor, limit: 2 });
    expect(second.orders.map((o) => o.external_order_id)).toEqual(['ORD-3']);
    expect(second.nextCursor).toBeNull();
  });

  it('honours the since watermark', async () => {
    const page = await adapter.fetchPage({
      since: new Date('2027-01-01T00:00:00.000Z'),
      cursor: null,
      limit: 10,
    });
    expect(page.orders).toHaveLength(0);
  });

  it('can be made to fail so retry paths have something real to exercise', async () => {
    const flaky = new MockOrderSourceAdapter({ orders: [order('ORD-1')], failEveryNthCall: 1 });
    await expect(flaky.fetchPage({ since: new Date(0), cursor: null, limit: 1 })).rejects.toThrow();
  });
});

describe('OrderSourceRegistry', () => {
  it('resolves an adapter by the name stored on the connection row', () => {
    const registry = new OrderSourceRegistry();
    registry.register('mock', () => new MockOrderSourceAdapter({ orders: [] }));
    expect(registry.create('mock', {}).name).toBe('mock');
  });

  it('names the registered adapters when asked for one that does not exist', () => {
    const registry = new OrderSourceRegistry();
    registry.register('mock', () => new MockOrderSourceAdapter({ orders: [] }));
    expect(() => registry.create('shopify', {})).toThrow(/Registered: mock/);
  });
});
