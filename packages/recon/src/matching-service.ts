import { and, eq, gte, lt } from 'drizzle-orm';
import type { Transaction } from '@magic/db';
import { schema } from '@magic/db';
import { matchSettlement } from '@magic/domain';
import type { OrderSnapshot, SettlementSnapshot } from '@magic/domain';
import type { ChargeType, SettlementStatus } from '@magic/contracts';

export interface MatchingOptions {
  readonly tenantId: string;
  readonly from: Date;
  readonly to: Date;
  readonly runId?: string | null;
  readonly heuristicWindowSeconds?: number;
  readonly autoAcceptConfidence?: number;
}

/**
 * Runs tiered matching over a window and records the tier alongside every pairing, including the
 * candidates it rejected. An operator reading an amount-mismatch finding can then see not only
 * which order was chosen but which ones were considered and why they lost.
 */
export async function runMatching(tx: Transaction, options: MatchingOptions): Promise<{ matched: number; unmatched: number }> {
  const settlementRows = await tx
    .select()
    .from(schema.settlements)
    .where(
      and(
        eq(schema.settlements.tenantId, options.tenantId),
        gte(schema.settlements.chargedAt, options.from),
        lt(schema.settlements.chargedAt, options.to),
      ),
    );

  const orderRows = await tx
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.tenantId, options.tenantId),
        gte(schema.orders.placedAt, new Date(options.from.getTime() - 7 * 86_400_000)),
        lt(schema.orders.placedAt, new Date(options.to.getTime() + 86_400_000)),
      ),
    );

  const orders: OrderSnapshot[] = orderRows.map((o) => ({
    id: o.id,
    externalOrderId: o.externalOrderId,
    merchantAccountId: o.merchantAccountId,
    totalMinor: o.totalMinor,
    currency: o.currency,
    expectedPlatformFeeMinor: o.expectedPlatformFeeMinor,
    status: o.status,
    fulfillmentStatus: o.fulfillmentStatus,
    customerEmail: o.customerEmail,
    paymentIntentId: o.paymentIntentId,
    placedAt: o.placedAt.toISOString(),
    fulfilledAt: o.fulfilledAt?.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
  }));

  let matched = 0;
  let unmatched = 0;

  for (const row of settlementRows) {
    const [charge] = await tx
      .select()
      .from(schema.charges)
      .where(and(eq(schema.charges.tenantId, options.tenantId), eq(schema.charges.stripeChargeId, row.chargeId)))
      .limit(1);

    const settlement: SettlementSnapshot = {
      chargeId: row.chargeId,
      chargeType: row.chargeType as ChargeType,
      fundsHolderAccountId: row.fundsHolderAccountId,
      merchantAccountId: row.merchantAccountId,
      currency: row.currency,
      customerGrossMinor: row.customerGrossMinor,
      processingFeeMinor: row.processingFeeMinor,
      platformRevenueMinor: row.platformRevenueMinor,
      merchantNetMinor: row.merchantNetMinor,
      refundedMinor: row.refundedMinor,
      reversedToPlatformMinor: row.reversedToPlatformMinor,
      settlementStatus: row.settlementStatus as SettlementStatus,
      payoutId: row.payoutId,
      chargedAt: row.chargedAt.toISOString(),
    };

    const result = matchSettlement({
      settlement,
      chargeMetadata: (charge?.metadata ?? {}) as Record<string, string>,
      paymentIntentId: charge?.paymentIntentId ?? null,
      customerEmail: charge?.customerEmail ?? null,
      orders,
      heuristicWindowSeconds: options.heuristicWindowSeconds ?? 7_200,
      autoAcceptConfidence: options.autoAcceptConfidence ?? 0.6,
    });

    if (result.match.orderId) matched += 1;
    else unmatched += 1;

    await tx
      .insert(schema.matches)
      .values({
        tenantId: options.tenantId,
        settlementId: row.id,
        orderId: result.match.orderId,
        tier: result.match.tier,
        confidence: String(result.match.confidence),
        method: result.match.method,
        candidates: result.candidates,
        runId: options.runId ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.matches.tenantId, schema.matches.settlementId],
        set: {
          orderId: result.match.orderId,
          tier: result.match.tier,
          confidence: String(result.match.confidence),
          method: result.match.method,
          candidates: result.candidates,
          runId: options.runId ?? null,
        },
      });
  }

  return { matched, unmatched };
}
