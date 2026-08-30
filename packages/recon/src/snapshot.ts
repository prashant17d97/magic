import { and, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Transaction } from '@magic/db';
import { schema } from '@magic/db';
import { checksumOf } from '@magic/domain';
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
} from '@magic/domain';
import type { ChargeType, SettlementStatus, MatchTier } from '@magic/contracts';

export interface SnapshotScope {
  readonly tenantId: string;
  readonly stripeAccountId: string;
  readonly platformAccountId: string;
  readonly payoutId: string | null;
  readonly windowStart: Date | null;
  readonly windowEnd: Date | null;
  readonly mode: 'transactional' | 'aggregate';
  readonly scopeType: 'payout' | 'window' | 'platform';
  readonly asOf: Date;
}

/**
 * Assembles the immutable world the rule engine sees. Everything is read once, inside the run's
 * transaction, and every collection is sorted by a stable key before it enters the snapshot —
 * a rule iterating an unsorted result set would produce a different order on a different plan
 * and fail the determinism test for a reason that has nothing to do with the rules.
 */
export async function assembleSnapshot(tx: Transaction, scope: SnapshotScope): Promise<ReconSnapshot> {
  const { tenantId, stripeAccountId } = scope;

  const [account] = await tx
    .select()
    .from(schema.connectedAccounts)
    .where(
      and(
        eq(schema.connectedAccounts.tenantId, tenantId),
        eq(schema.connectedAccounts.stripeAccountId, stripeAccountId),
      ),
    )
    .limit(1);

  const payoutRow = scope.payoutId
    ? (
        await tx
          .select()
          .from(schema.payouts)
          .where(and(eq(schema.payouts.tenantId, tenantId), eq(schema.payouts.stripePayoutId, scope.payoutId)))
          .limit(1)
      )[0]
    : undefined;

  const windowStart = scope.windowStart ?? new Date(Date.parse(scope.asOf.toISOString()) - 30 * 86_400_000);
  const windowEnd = scope.windowEnd ?? scope.asOf;

  /**
   * A window run is scoped to one account's ledger and to money still in flight.
   *
   * The account predicate stops every window run from seeing every account's transactions. The
   * payout predicate stops a window run from re-judging money that already landed: those objects
   * belong to their payout's run, and evaluating them twice would file the same discrepancy under
   * two different scopes.
   */
  const btxnScope = scope.payoutId
    ? eq(schema.balanceTransactions.payoutId, scope.payoutId)
    : and(
        eq(schema.balanceTransactions.stripeAccountId, stripeAccountId),
        isNull(schema.balanceTransactions.payoutId),
        gte(schema.balanceTransactions.stripeCreatedAt, windowStart),
        lt(schema.balanceTransactions.stripeCreatedAt, windowEnd),
      );

  const balanceRows = await tx
    .select()
    .from(schema.balanceTransactions)
    .where(and(eq(schema.balanceTransactions.tenantId, tenantId), btxnScope));

  const sourceIds = balanceRows.map((b) => b.sourceId).filter((id): id is string => id !== null);

  /**
   * A payout run sees the payout's own objects and nothing else. Widening it to the surrounding
   * window would make every charge-subject rule fire once per payout that happens to overlap,
   * turning one discrepancy into a row per deposit.
   */
  const chargeRows = await tx
    .select()
    .from(schema.charges)
    .where(
      and(
        eq(schema.charges.tenantId, tenantId),
        scope.payoutId
          ? sourceIds.length > 0
            ? inArray(schema.charges.stripeChargeId, sourceIds)
            : sql`false`
          : and(
              gte(schema.charges.stripeCreatedAt, windowStart),
              lt(schema.charges.stripeCreatedAt, windowEnd),
              or(
                sourceIds.length > 0 ? inArray(schema.charges.stripeChargeId, sourceIds) : sql`false`,
                and(
                  eq(schema.charges.stripeAccountId, stripeAccountId),
                  isNull(schema.charges.balanceTransactionId),
                ),
              ),
            ),
      ),
    );

  const chargeIds = chargeRows.map((c) => c.stripeChargeId);
  const hasCharges = chargeIds.length > 0;

  const [refundRows, transferRows, feeRows, disputeRows, settlementRows] = await Promise.all([
    tx
      .select()
      .from(schema.refunds)
      .where(
        and(
          eq(schema.refunds.tenantId, tenantId),
          hasCharges ? inArray(schema.refunds.chargeId, chargeIds) : sql`false`,
        ),
      ),
    tx
      .select()
      .from(schema.transfers)
      .where(
        and(
          eq(schema.transfers.tenantId, tenantId),
          scope.payoutId
            ? hasCharges
              ? or(
                  inArray(schema.transfers.sourceTransaction, chargeIds),
                  inArray(
                    schema.transfers.stripeTransferId,
                    chargeRows.map((c) => c.transferId).filter((id): id is string => id !== null),
                  ),
                )
              : sql`false`
            : and(
                gte(schema.transfers.stripeCreatedAt, windowStart),
                lt(schema.transfers.stripeCreatedAt, windowEnd),
              ),
        ),
      ),
    tx
      .select()
      .from(schema.applicationFees)
      .where(
        and(
          eq(schema.applicationFees.tenantId, tenantId),
          hasCharges ? inArray(schema.applicationFees.chargeId, chargeIds) : sql`false`,
        ),
      ),
    tx
      .select()
      .from(schema.disputes)
      .where(
        and(
          eq(schema.disputes.tenantId, tenantId),
          scope.payoutId
            ? hasCharges
              ? inArray(schema.disputes.chargeId, chargeIds)
              : sql`false`
            : and(
                gte(schema.disputes.stripeCreatedAt, windowStart),
                lt(schema.disputes.stripeCreatedAt, windowEnd),
              ),
        ),
      ),
    tx
      .select()
      .from(schema.settlements)
      .where(
        and(
          eq(schema.settlements.tenantId, tenantId),
          hasCharges ? inArray(schema.settlements.chargeId, chargeIds) : sql`false`,
        ),
      ),
  ]);

  const transferIds = transferRows.map((t) => t.stripeTransferId);
  const reversalRows = await tx
    .select()
    .from(schema.transferReversals)
    .where(
      and(
        eq(schema.transferReversals.tenantId, tenantId),
        transferIds.length > 0 ? inArray(schema.transferReversals.transferId, transferIds) : sql`false`,
      ),
    );

  const orderRows = await tx
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.tenantId, tenantId),
        gte(schema.orders.placedAt, new Date(windowStart.getTime() - 7 * 86_400_000)),
        lt(schema.orders.placedAt, windowEnd),
      ),
    );

  const settlementIds = settlementRows.map((s) => s.id);
  /**
   * Matches are loaded by settlement and by order. Loading only by settlement would make an
   * order that is matched to a payment outside this scope look unmatched, and the order-side
   * rules would report a payment gap that does not exist.
   */
  const orderIds = orderRows.map((o) => o.id);
  const matchRows = await tx
    .select()
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.tenantId, tenantId),
        or(
          settlementIds.length > 0 ? inArray(schema.matches.settlementId, settlementIds) : sql`false`,
          orderIds.length > 0 ? inArray(schema.matches.orderId, orderIds) : sql`false`,
        ),
      ),
    );

  /**
   * Settlements are also loaded for anything a match points at, not only for charges in scope.
   * Without this, a rule that reasons over matched orders can see the match but not the money,
   * and reports a real discrepancy with a zero figure attached.
   */
  const allSettlementIds = [...new Set(matchRows.map((m) => m.settlementId))];
  const extraSettlements = await tx
    .select()
    .from(schema.settlements)
    .where(
      and(
        eq(schema.settlements.tenantId, tenantId),
        allSettlementIds.length > 0 ? inArray(schema.settlements.id, allSettlementIds) : sql`false`,
      ),
    );

  const settlementsById = new Map([...settlementRows, ...extraSettlements].map((row) => [row.id, row]));
  const allSettlements = [...settlementsById.values()];
  const settlementLookup = allSettlements.map((row) => ({ id: row.id, chargeId: row.chargeId }));

  const settlementById = new Map(settlementLookup.map((s) => [s.id, s.chargeId]));

  const body = {
    asOf: scope.asOf.toISOString(),
    tenantId,
    stripeAccountId,
    platformAccountId: scope.platformAccountId,
    scopeKey: scope.payoutId
      ? `payout:${scope.payoutId}`
      : `window:${stripeAccountId}:${windowEnd.toISOString().slice(0, 10)}`,
    scopeType: scope.scopeType,
    mode: scope.mode,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    accountState: {
      stripeAccountId,
      displayName: account?.displayName ?? null,
      chargesEnabled: account?.chargesEnabled ?? true,
      payoutsEnabled: account?.payoutsEnabled ?? true,
      requirementsDisabledReason: account?.requirementsDisabledReason ?? null,
      defaultCurrency: account?.defaultCurrency ?? null,
    },
    payout: payoutRow
      ? ({
          id: payoutRow.stripePayoutId,
          stripeAccountId: payoutRow.stripeAccountId,
          amountMinor: payoutRow.amountMinor,
          currency: payoutRow.currency,
          status: payoutRow.status,
          arrivalDate: payoutRow.arrivalDate,
          createdAt: payoutRow.stripeCreatedAt.toISOString(),
          balanceTransactionId: payoutRow.balanceTransactionId,
        } satisfies PayoutSnapshot)
      : null,
    balanceTransactions: sortById(
      balanceRows.map(
        (b): BalanceTxnSnapshot => ({
          id: b.stripeBtxnId,
          stripeAccountId: b.stripeAccountId,
          type: b.type,
          sourceId: b.sourceId,
          grossMinor: b.grossMinor,
          feeMinor: b.feeMinor,
          netMinor: b.netMinor,
          currency: b.currency,
          payoutId: b.payoutId,
          createdAt: b.stripeCreatedAt.toISOString(),
        }),
      ),
    ),
    charges: sortById(
      chargeRows.map(
        (c): ChargeSnapshot => ({
          id: c.stripeChargeId,
          stripeAccountId: c.stripeAccountId,
          paymentIntentId: c.paymentIntentId,
          balanceTransactionId: c.balanceTransactionId,
          amountMinor: c.amountMinor,
          currency: c.currency,
          amountRefundedMinor: c.amountRefundedMinor,
          amountCapturedMinor: c.amountCapturedMinor,
          status: c.status,
          paid: c.paid,
          refunded: c.refunded,
          disputed: c.disputed,
          captured: c.captured,
          onBehalfOf: c.onBehalfOf,
          transferDestination: c.transferDestination,
          transferDataAmountMinor: c.transferDataAmountMinor,
          transferId: c.transferId,
          applicationFeeId: c.applicationFeeId,
          sourceTransferId: c.sourceTransferId,
          chargeType: (c.chargeType ?? 'unclassified') as ChargeType,
          chargeTypeConfidence: Number(c.chargeTypeConfidence ?? 0),
          customerEmail: c.customerEmail,
          metadata: (c.metadata ?? {}) as Record<string, string>,
          createdAt: c.stripeCreatedAt.toISOString(),
        }),
      ),
    ),
    refunds: sortById(
      refundRows.map(
        (r): RefundSnapshot => ({
          id: r.stripeRefundId,
          chargeId: r.chargeId,
          amountMinor: r.amountMinor,
          currency: r.currency,
          status: r.status,
          reason: r.reason,
          transferReversalId: r.transferReversalId,
          createdAt: r.stripeCreatedAt.toISOString(),
        }),
      ),
    ),
    transfers: sortById(
      transferRows.map(
        (t): TransferSnapshot => ({
          id: t.stripeTransferId,
          destinationAccountId: t.destinationAccountId,
          amountMinor: t.amountMinor,
          amountReversedMinor: t.amountReversedMinor,
          currency: t.currency,
          sourceTransaction: t.sourceTransaction,
          createdAt: t.stripeCreatedAt.toISOString(),
        }),
      ),
    ),
    reversals: sortById(
      reversalRows.map(
        (r): ReversalSnapshot => ({
          id: r.stripeReversalId,
          transferId: r.transferId,
          amountMinor: r.amountMinor,
          currency: r.currency,
          createdAt: r.stripeCreatedAt.toISOString(),
        }),
      ),
    ),
    applicationFees: sortById(
      feeRows.map(
        (f): AppFeeSnapshot => ({
          id: f.stripeFeeId,
          chargeId: f.chargeId,
          originatingAccountId: f.originatingAccountId,
          amountMinor: f.amountMinor,
          amountRefundedMinor: f.amountRefundedMinor,
          currency: f.currency,
          refunded: f.refunded,
          createdAt: f.stripeCreatedAt.toISOString(),
        }),
      ),
    ),
    disputes: sortById(
      disputeRows.map(
        (d): DisputeSnapshot => ({
          id: d.stripeDisputeId,
          chargeId: d.chargeId,
          amountMinor: d.amountMinor,
          currency: d.currency,
          status: d.status,
          reason: d.reason,
          createdAt: d.stripeCreatedAt.toISOString(),
        }),
      ),
    ),
    settlements: allSettlements
      .map(
        (s): SettlementSnapshot => ({
          chargeId: s.chargeId,
          chargeType: s.chargeType as ChargeType,
          fundsHolderAccountId: s.fundsHolderAccountId,
          merchantAccountId: s.merchantAccountId,
          currency: s.currency,
          customerGrossMinor: s.customerGrossMinor,
          processingFeeMinor: s.processingFeeMinor,
          platformRevenueMinor: s.platformRevenueMinor,
          merchantNetMinor: s.merchantNetMinor,
          refundedMinor: s.refundedMinor,
          reversedToPlatformMinor: s.reversedToPlatformMinor,
          settlementStatus: s.settlementStatus as SettlementStatus,
          payoutId: s.payoutId,
          chargedAt: s.chargedAt.toISOString(),
        }),
      )
      .sort((a, b) => (a.chargeId < b.chargeId ? -1 : 1)),
    orders: sortById(
      orderRows.map(
        (o): OrderSnapshot => ({
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
        }),
      ),
    ),
    matches: matchRows
      .map(
        (m): MatchSnapshot => ({
          settlementChargeId: settlementById.get(m.settlementId) ?? m.settlementId,
          orderId: m.orderId,
          tier: m.tier as MatchTier,
          confidence: Number(m.confidence),
          method: m.method,
        }),
      )
      .sort((a, b) => (a.settlementChargeId < b.settlementChargeId ? -1 : 1)),
  };

  return { ...body, checksum: checksumOf(body) };
}

function sortById<T extends { id: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
