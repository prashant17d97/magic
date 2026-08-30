import { z } from 'zod';

/**
 * The adapter contract is defined by the `orders` schema, not by whichever integration happens
 * to be built first. The mock is a conforming implementation, and so will Shopify be — neither
 * gets a special case anywhere above this interface.
 */
export const NormalisedOrderLineSchema = z.object({
  sku: z.string().nullable(),
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price_minor: z.string().regex(/^-?\d+$/),
  currency: z.string().length(3),
});

export const NormalisedShipmentSchema = z.object({
  carrier: z.string().nullable(),
  tracking_number: z.string().nullable(),
  status: z.string(),
  shipped_at: z.string().nullable(),
  delivered_at: z.string().nullable(),
});

export const NormalisedOrderSchema = z.object({
  external_order_id: z.string().min(1),
  merchant_account_id: z.string().nullable(),
  total_minor: z.string().regex(/^-?\d+$/),
  currency: z.string().length(3),
  expected_platform_fee_minor: z.string().regex(/^-?\d+$/).nullable(),
  status: z.enum(['created', 'paid', 'fulfilled', 'cancelled', 'refunded']),
  fulfillment_status: z.enum(['unfulfilled', 'partial', 'fulfilled', 'returned']).nullable(),
  customer_email: z.string().nullable(),
  payment_intent_id: z.string().nullable(),
  placed_at: z.string(),
  fulfilled_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  lines: z.array(NormalisedOrderLineSchema).default([]),
  shipments: z.array(NormalisedShipmentSchema).default([]),
  raw: z.record(z.string(), z.unknown()).default({}),
});

export type NormalisedOrder = z.infer<typeof NormalisedOrderSchema>;

export interface OrderPage {
  readonly orders: readonly NormalisedOrder[];
  readonly nextCursor: string | null;
}

export interface OrderSourceAdapter {
  readonly name: string;
  /**
   * Pulls a page of orders changed at or after `since`. Cursor-based so a sync that dies halfway
   * resumes rather than restarting, which matters once a client has a year of history.
   */
  fetchPage(options: { since: Date; cursor: string | null; limit: number }): Promise<OrderPage>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

/** Every adapter's output passes through here. A malformed order fails at its own boundary. */
export function validateOrders(input: unknown[]): NormalisedOrder[] {
  return input.map((order, index) => {
    const result = NormalisedOrderSchema.safeParse(order);
    if (!result.success) {
      throw new Error(
        `Order at index ${index} does not conform to the adapter contract: ${result.error.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
      );
    }
    return result.data;
  });
}
