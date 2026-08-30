import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Transaction } from '@magic/db';
import { schema } from '@magic/db';
import { classifyCharge, normaliseSettlement } from '@magic/domain';
import type { AppFeeSnapshot, BalanceTxnSnapshot, ChargeSnapshot, DisputeSnapshot, RefundSnapshot, ReversalSnapshot, TransferSnapshot } from '@magic/domain';
import type { ChargeType } from '@magic/contracts';

/**
 * Classifies a charge and recomputes its settlement row from whatever is currently projected.
 *
 * This is called after every projection write rather than once at the end, because the settlement
 * layer is the thing the whole product reads: a charge whose refund lands an hour later must
 * produce a corrected settlement immediately, not at the next reconciliation run.
 */
export async function recomputeSettlement(
  tx: Transaction,
  args: { tenantId: string; platformAccountId: string; chargeId: string },
): Promise<void> {
  const [charge] = await tx
    .select()
    .from(schema.charges)
    .where(and(eq(schema.charges.tenantId, args.tenantId), eq(schema.charges.stripeChargeId, args.chargeId)))
    .limit(1);

  if (!charge) return;

  const classification = classifyCharge({
    id: charge.stripeChargeId,
    stripeAccountId: charge.stripeAccountId,
    platformAccountId: args.platformAccountId,
    onBehalfOf: charge.onBehalfOf,
    transferDestination: charge.transferDestination,
    transferId: charge.transferId,
    applicationFeeId: charge.applicationFeeId,
    sourceTransferId: charge.sourceTransferId,
    transferDataAmountMinor: charge.transferDataAmountMinor,
  });

  await tx
    .update(schema.charges)
    .set({
      chargeType: classification.chargeType,
      chargeTypeConfidence: String(classification.confidence),
      chargeTypeSignals: { ...classification.signals, reason: classification.reason },
    })
    .where(eq(schema.charges.id, charge.id));

  if (classification.chargeType === 'unclassified') return;

  const [balanceRows, refundRows, transferRows, feeRows, disputeRows] = await Promise.all([
    tx
      .select()
      .from(schema.balanceTransactions)
      .where(
        and(
          eq(schema.balanceTransactions.tenantId, args.tenantId),
          eq(schema.balanceTransactions.sourceId, charge.stripeChargeId),
        ),
      ),
    tx
      .select()
      .from(schema.refunds)
      .where(and(eq(schema.refunds.tenantId, args.tenantId), eq(schema.refunds.chargeId, charge.stripeChargeId))),
    tx
      .select()
      .from(schema.transfers)
      .where(
        and(
          eq(schema.transfers.tenantId, args.tenantId),
          charge.transferId
            ? sql`(${schema.transfers.stripeTransferId} = ${charge.transferId} OR ${schema.transfers.sourceTransaction} = ${charge.stripeChargeId})`
            : eq(schema.transfers.sourceTransaction, charge.stripeChargeId),
        ),
      ),
    tx
      .select()
      .from(schema.applicationFees)
      .where(
        and(eq(schema.applicationFees.tenantId, args.tenantId), eq(schema.applicationFees.chargeId, charge.stripeChargeId)),
      ),
    tx
      .select()
      .from(schema.disputes)
      .where(and(eq(schema.disputes.tenantId, args.tenantId), eq(schema.disputes.chargeId, charge.stripeChargeId))),
  ]);

  const transferIds = transferRows.map((t) => t.stripeTransferId);
  const reversalRows =
    transferIds.length > 0
      ? await tx
          .select()
          .from(schema.transferReversals)
          .where(
            and(
              eq(schema.transferReversals.tenantId, args.tenantId),
              inArray(schema.transferReversals.transferId, transferIds),
            ),
          )
      : [];

  const chargeSnapshot: ChargeSnapshot = {
    id: charge.stripeChargeId,
    stripeAccountId: charge.stripeAccountId,
    paymentIntentId: charge.paymentIntentId,
    balanceTransactionId: charge.balanceTransactionId,
    amountMinor: charge.amountMinor,
    currency: charge.currency,
    amountRefundedMinor: charge.amountRefundedMinor,
    amountCapturedMinor: charge.amountCapturedMinor,
    status: charge.status,
    paid: charge.paid,
    refunded: charge.refunded,
    disputed: charge.disputed,
    captured: charge.captured,
    onBehalfOf: charge.onBehalfOf,
    transferDestination: charge.transferDestination,
    transferDataAmountMinor: charge.transferDataAmountMinor,
    transferId: charge.transferId,
    applicationFeeId: charge.applicationFeeId,
    sourceTransferId: charge.sourceTransferId,
    chargeType: classification.chargeType as ChargeType,
    chargeTypeConfidence: classification.confidence,
    customerEmail: charge.customerEmail,
    metadata: (charge.metadata ?? {}) as Record<string, string>,
    createdAt: charge.stripeCreatedAt.toISOString(),
  };

  const settlement = normaliseSettlement({
    charge: chargeSnapshot,
    platformAccountId: args.platformAccountId,
    balanceTransactions: balanceRows.map(
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
    refunds: refundRows.map(
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
    transfers: transferRows.map(
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
    reversals: reversalRows.map(
      (r): ReversalSnapshot => ({
        id: r.stripeReversalId,
        transferId: r.transferId,
        amountMinor: r.amountMinor,
        currency: r.currency,
        createdAt: r.stripeCreatedAt.toISOString(),
      }),
    ),
    applicationFees: feeRows.map(
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
    disputes: disputeRows.map(
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
  });


  /**
   * A charge refunded beyond what it captured has no coherent settlement, so none is written.
   * The database CHECK would reject it anyway; refusing here keeps the surrounding transaction
   * healthy and leaves the Layer 1 rule free to report the overage from the raw objects.
   */
  if (settlement.refundedMinor > settlement.customerGrossMinor) return;
  await tx
    .insert(schema.settlements)
    .values({
      tenantId: args.tenantId,
      chargeId: settlement.chargeId,
      chargeType: settlement.chargeType,
      fundsHolderAccountId: settlement.fundsHolderAccountId,
      merchantAccountId: settlement.merchantAccountId,
      currency: settlement.currency,
      customerGrossMinor: settlement.customerGrossMinor,
      processingFeeMinor: settlement.processingFeeMinor,
      platformRevenueMinor: settlement.platformRevenueMinor,
      merchantNetMinor: settlement.merchantNetMinor,
      refundedMinor: settlement.refundedMinor,
      reversedToPlatformMinor: settlement.reversedToPlatformMinor,
      settlementStatus: settlement.settlementStatus,
      payoutId: settlement.payoutId,
      feeBearer: settlement.chargeType === 'direct' ? 'merchant' : 'platform',
      chargedAt: new Date(settlement.chargedAt),
      settledAt: settlement.payoutId ? new Date(settlement.chargedAt) : null,
      computedFromVersion: charge.sourceVersion,
    })
    .onConflictDoUpdate({
      target: [schema.settlements.tenantId, schema.settlements.chargeId],
      set: {
        chargeType: settlement.chargeType,
        fundsHolderAccountId: settlement.fundsHolderAccountId,
        merchantAccountId: settlement.merchantAccountId,
        customerGrossMinor: settlement.customerGrossMinor,
        processingFeeMinor: settlement.processingFeeMinor,
        platformRevenueMinor: settlement.platformRevenueMinor,
        merchantNetMinor: settlement.merchantNetMinor,
        refundedMinor: settlement.refundedMinor,
        reversedToPlatformMinor: settlement.reversedToPlatformMinor,
        settlementStatus: settlement.settlementStatus,
        payoutId: settlement.payoutId,
        computedAt: new Date(),
        computedFromVersion: charge.sourceVersion,
      },
    });
}

/** Recomputes every settlement in a window. Used after a backfill or a mapper fix. */
export async function recomputeWindow(
  tx: Transaction,
  args: { tenantId: string; platformAccountId: string; from: Date; to: Date },
): Promise<number> {
  const rows = await tx
    .select({ chargeId: schema.charges.stripeChargeId })
    .from(schema.charges)
    .where(
      and(
        eq(schema.charges.tenantId, args.tenantId),
        gte(schema.charges.stripeCreatedAt, args.from),
        lt(schema.charges.stripeCreatedAt, args.to),
      ),
    );

  for (const row of rows) {
    await recomputeSettlement(tx, { ...args, chargeId: row.chargeId });
  }
  return rows.length;
}
