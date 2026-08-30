import { type NormalisedOrder, type OrderPage, type OrderSourceAdapter, validateOrders } from './contract.js';

export interface MockAdapterConfig {
  readonly orders: readonly NormalisedOrder[];
  readonly failEveryNthCall?: number;
}

/**
 * The reference implementation. It is a conforming adapter rather than a test double, which is
 * the point: the contract is proven by two implementations before a second one is ever written.
 *
 * `failEveryNthCall` exists so the sync worker's retry and cursor-resume paths have something
 * real to fail against in tests.
 */
export class MockOrderSourceAdapter implements OrderSourceAdapter {
  readonly name = 'mock';

  private readonly orders: readonly NormalisedOrder[];
  private readonly failEveryNthCall: number;
  private callCount = 0;

  constructor(config: MockAdapterConfig) {
    this.orders = validateOrders([...config.orders]);
    this.failEveryNthCall = config.failEveryNthCall ?? 0;
  }

  async fetchPage(options: { since: Date; cursor: string | null; limit: number }): Promise<OrderPage> {
    this.callCount += 1;
    if (this.failEveryNthCall > 0 && this.callCount % this.failEveryNthCall === 0) {
      throw new Error('Mock order source is unavailable.');
    }

    const eligible = this.orders
      .filter((o) => Date.parse(o.placed_at) >= options.since.getTime())
      .sort((a, b) => (a.external_order_id < b.external_order_id ? -1 : 1));

    const start = options.cursor ? eligible.findIndex((o) => o.external_order_id === options.cursor) + 1 : 0;
    const page = eligible.slice(start, start + options.limit);
    const last = page[page.length - 1];
    const hasMore = start + page.length < eligible.length;

    return { orders: page, nextCursor: hasMore && last ? last.external_order_id : null };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: `Mock adapter holding ${this.orders.length} orders.` };
  }
}
