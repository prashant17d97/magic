import { and, eq } from 'drizzle-orm';
import type { Database } from '@magic/db';
import { schema, withTenant } from '@magic/db';
import { recomputeSettlement } from '@magic/recon';
import type { StripeAccountClient, StripeClientFactory } from '@magic/stripe-client';
import { currencyOf, idOf, metadataOf, sourceVersion, toDate, toMinor } from '@magic/stripe-client';
import type Stripe from 'stripe';
import type { Logger } from 'pino';

export interface EventJob {
  readonly tenantId: string;
  readonly stripeEventId: string;
  readonly connectionId?: string;
  readonly eventType: string;
  readonly objectId: string | null;
  readonly objectType: string | null;
  readonly stripeAccountId: string | null;
}

export interface EventProcessorDeps {
  readonly db: Database;
  readonly logger: Logger;
  readonly stripe: StripeClientFactory | null;
  readonly platformAccountId?: string;
}

/**
 * Processes one webhook event.
 *
 * The payload is treated as a change notification, never as data. The worker re-fetches the
 * canonical object from Stripe with the correct account context and writes that. Ordering then
 * stops mattering entirely: `charge.refunded` arriving before `charge.succeeded` still results in
 * the current truth, with no reordering buffer and no conditional merge logic.
 *
 * With Stripe disabled the processor works from the stored payload instead, which is what lets a
 * developer run the whole fleet against seeded data with no credentials.
 */
export async function processEvent(deps: EventProcessorDeps, job: EventJob): Promise<void> {
  const { db, logger } = deps;

  const event = await withTenant(db, { tenantId: job.tenantId }, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.stripeEvents)
      .where(
        and(
          eq(schema.stripeEvents.tenantId, job.tenantId),
          eq(schema.stripeEvents.stripeEventId, job.stripeEventId),
        ),
      )
      .limit(1);
    return rows[0];
  });

  if (!event) {
    logger.warn({ stripeEventId: job.stripeEventId }, 'Event row is missing; nothing to process.');
    return;
  }

  if (event.processStatus === 'processed') return;

  /**
   * The connection is optional so that a job enqueued before the field existed still processes
   * against the platform default, rather than reaching the driver with an undefined parameter and
   * failing with a query error that says nothing about what was actually wrong.
   */
  const connectionId = job.connectionId;
  const [connection] = connectionId
    ? await withTenant(db, { tenantId: job.tenantId }, async (tx) =>
        tx
          .select()
          .from(schema.stripeConnections)
          .where(eq(schema.stripeConnections.id, connectionId))
          .limit(1),
      )
    : [undefined];

  const platformAccountId = deps.platformAccountId ?? connection?.stripeAccountId ?? 'acct_platform';

  try {
    const client = deps.stripe
      ? await deps.stripe.forAccount({
          apiKeyRef: connection?.apiKeyRef ?? 'STRIPE_PLATFORM_API_KEY',
          platformAccountId,
          ...(job.stripeAccountId ? { connectedAccountId: job.stripeAccountId } : {}),
        })
      : null;

    const payloadObject = (event.payload as { data?: { object?: Record<string, unknown> } }).data?.object ?? {};
    const ledgerAccountId = job.stripeAccountId ?? platformAccountId;

    await withTenant(db, { tenantId: job.tenantId }, async (tx) => {
      await applyProjection(tx, {
        tenantId: job.tenantId,
        ledgerAccountId,
        platformAccountId,
        objectType: job.objectType,
        object: payloadObject,
        client,
        objectId: job.objectId,
      });

      await tx
        .update(schema.stripeEvents)
        .set({ processStatus: 'processed', processedAt: new Date(), lastError: null })
        .where(eq(schema.stripeEvents.id, event.id));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(db, { tenantId: job.tenantId }, async (tx) => {
      await tx
        .update(schema.stripeEvents)
        .set({
          processStatus: 'failed',
          attemptCount: event.attemptCount + 1,
          lastError: message.slice(0, 2000),
        })
        .where(eq(schema.stripeEvents.id, event.id));
    });
    throw error;
  }
}

interface ProjectionArgs {
  readonly tenantId: string;
  readonly ledgerAccountId: string;
  readonly platformAccountId: string;
  readonly objectType: string | null;
  readonly object: Record<string, unknown>;
  readonly client: StripeAccountClient | null;
  readonly objectId: string | null;
}

/**
 * Upserts one Stripe object into its projection.
 *
 * Every upsert is guarded by `source_version`, so a late-arriving stale write is a no-op instead
 * of an overwrite. That is what removes the need for a locking scheme when deliveries interleave.
 */
async function applyProjection(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  args: ProjectionArgs,
): Promise<void> {
  const observedAt = Date.now();

  switch (args.objectType) {
    case 'charge': {
      const charge = (args.client && args.objectId
        ? await args.client.retrieveCharge(args.objectId)
        : args.object) as unknown as Stripe.Charge;

      await tx
        .insert(schema.charges)
        .values({
          tenantId: args.tenantId,
          stripeAccountId: args.ledgerAccountId,
          stripeChargeId: charge.id,
          paymentIntentId: idOf(charge.payment_intent),
          balanceTransactionId: idOf(charge.balance_transaction),
          amountMinor: toMinor(charge.amount),
          currency: currencyOf(charge.currency, 'charge', charge.id),
          amountRefundedMinor: toMinor(charge.amount_refunded),
          amountCapturedMinor: toMinor(charge.amount_captured),
          status: charge.status,
          paid: charge.paid,
          refunded: charge.refunded,
          disputed: charge.disputed,
          captured: charge.captured,
          onBehalfOf: idOf(charge.on_behalf_of),
          transferDestination: idOf(charge.transfer_data?.destination ?? null),
          transferDataAmountMinor: charge.transfer_data?.amount != null ? toMinor(charge.transfer_data.amount) : null,
          transferId: idOf(charge.transfer ?? null),
          applicationFeeId: idOf(charge.application_fee ?? null),
          sourceTransferId: idOf(charge.source_transfer ?? null),
          paymentMethodBrand: charge.payment_method_details?.card?.brand ?? null,
          paymentMethodLast4: charge.payment_method_details?.card?.last4 ?? null,
          customerEmail: charge.billing_details?.email ?? charge.receipt_email ?? null,
          metadata: metadataOf(charge.metadata),
          stripeCreatedAt: toDate(charge.created),
          sourceVersion: sourceVersion(charge.created, observedAt),
        })
        .onConflictDoUpdate({
          target: [schema.charges.tenantId, schema.charges.stripeChargeId],
          set: {
            balanceTransactionId: idOf(charge.balance_transaction),
            amountRefundedMinor: toMinor(charge.amount_refunded),
            amountCapturedMinor: toMinor(charge.amount_captured),
            status: charge.status,
            paid: charge.paid,
            refunded: charge.refunded,
            disputed: charge.disputed,
            captured: charge.captured,
            transferId: idOf(charge.transfer ?? null),
            applicationFeeId: idOf(charge.application_fee ?? null),
            metadata: metadataOf(charge.metadata),
            sourceVersion: sourceVersion(charge.created, observedAt),
            syncedAt: new Date(),
          },
        });

      await recomputeSettlement(tx, {
        tenantId: args.tenantId,
        platformAccountId: args.platformAccountId,
        chargeId: charge.id,
      });
      return;
    }

    case 'payout': {
      const payout = (args.client && args.objectId
        ? await args.client.retrievePayout(args.objectId)
        : args.object) as unknown as Stripe.Payout;

      await tx
        .insert(schema.payouts)
        .values({
          tenantId: args.tenantId,
          stripeAccountId: args.ledgerAccountId,
          stripePayoutId: payout.id,
          amountMinor: toMinor(payout.amount),
          currency: currencyOf(payout.currency, 'payout', payout.id),
          status: payout.status,
          arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString().slice(0, 10) : null,
          balanceTransactionId: idOf(payout.balance_transaction ?? null),
          automatic: payout.automatic,
          stripeCreatedAt: toDate(payout.created),
          sourceVersion: sourceVersion(payout.created, observedAt),
        })
        .onConflictDoUpdate({
          target: [schema.payouts.tenantId, schema.payouts.stripePayoutId],
          set: {
            status: payout.status,
            amountMinor: toMinor(payout.amount),
            balanceTransactionId: idOf(payout.balance_transaction ?? null),
            sourceVersion: sourceVersion(payout.created, observedAt),
            syncedAt: new Date(),
          },
        });
      return;
    }

    case 'refund': {
      const refund = args.object as unknown as Stripe.Refund;
      await tx
        .insert(schema.refunds)
        .values({
          tenantId: args.tenantId,
          stripeAccountId: args.ledgerAccountId,
          stripeRefundId: refund.id,
          chargeId: idOf(refund.charge) ?? '',
          amountMinor: toMinor(refund.amount),
          currency: currencyOf(refund.currency, 'refund', refund.id),
          status: refund.status ?? 'succeeded',
          reason: refund.reason ?? null,
          balanceTransactionId: idOf(refund.balance_transaction ?? null),
          transferReversalId: idOf(refund.transfer_reversal ?? null),
          stripeCreatedAt: toDate(refund.created),
          sourceVersion: sourceVersion(refund.created, observedAt),
        })
        .onConflictDoUpdate({
          target: [schema.refunds.tenantId, schema.refunds.stripeRefundId],
          set: {
            status: refund.status ?? 'succeeded',
            transferReversalId: idOf(refund.transfer_reversal ?? null),
            sourceVersion: sourceVersion(refund.created, observedAt),
            syncedAt: new Date(),
          },
        });

      const chargeId = idOf(refund.charge);
      if (chargeId) {
        await recomputeSettlement(tx, {
          tenantId: args.tenantId,
          platformAccountId: args.platformAccountId,
          chargeId,
        });
      }
      return;
    }

    case 'transfer': {
      const transfer = args.object as unknown as Stripe.Transfer;
      await tx
        .insert(schema.transfers)
        .values({
          tenantId: args.tenantId,
          stripeTransferId: transfer.id,
          destinationAccountId: idOf(transfer.destination) ?? '',
          amountMinor: toMinor(transfer.amount),
          amountReversedMinor: toMinor(transfer.amount_reversed),
          currency: currencyOf(transfer.currency, 'transfer', transfer.id),
          sourceTransaction: idOf(transfer.source_transaction ?? null),
          balanceTransactionId: idOf(transfer.balance_transaction ?? null),
          stripeCreatedAt: toDate(transfer.created),
          sourceVersion: sourceVersion(transfer.created, observedAt),
        })
        .onConflictDoUpdate({
          target: [schema.transfers.tenantId, schema.transfers.stripeTransferId],
          set: {
            amountReversedMinor: toMinor(transfer.amount_reversed),
            sourceVersion: sourceVersion(transfer.created, observedAt),
            syncedAt: new Date(),
          },
        });
      return;
    }

    case 'application_fee': {
      const fee = args.object as unknown as Stripe.ApplicationFee;
      await tx
        .insert(schema.applicationFees)
        .values({
          tenantId: args.tenantId,
          stripeFeeId: fee.id,
          chargeId: idOf(fee.charge) ?? '',
          originatingAccountId: idOf(fee.account) ?? '',
          amountMinor: toMinor(fee.amount),
          amountRefundedMinor: toMinor(fee.amount_refunded),
          currency: currencyOf(fee.currency, 'application_fee', fee.id),
          refunded: fee.refunded,
          stripeCreatedAt: toDate(fee.created),
          sourceVersion: sourceVersion(fee.created, observedAt),
        })
        .onConflictDoUpdate({
          target: [schema.applicationFees.tenantId, schema.applicationFees.stripeFeeId],
          set: {
            amountRefundedMinor: toMinor(fee.amount_refunded),
            refunded: fee.refunded,
            sourceVersion: sourceVersion(fee.created, observedAt),
          },
        });
      return;
    }

    case 'dispute': {
      const dispute = args.object as unknown as Stripe.Dispute;
      await tx
        .insert(schema.disputes)
        .values({
          tenantId: args.tenantId,
          stripeAccountId: args.ledgerAccountId,
          stripeDisputeId: dispute.id,
          chargeId: idOf(dispute.charge) ?? '',
          amountMinor: toMinor(dispute.amount),
          currency: currencyOf(dispute.currency, 'dispute', dispute.id),
          status: dispute.status,
          reason: dispute.reason,
          evidenceDueBy: dispute.evidence_details?.due_by ? toDate(dispute.evidence_details.due_by) : null,
          stripeCreatedAt: toDate(dispute.created),
          sourceVersion: sourceVersion(dispute.created, observedAt),
        })
        .onConflictDoUpdate({
          target: [schema.disputes.tenantId, schema.disputes.stripeDisputeId],
          set: {
            status: dispute.status,
            sourceVersion: sourceVersion(dispute.created, observedAt),
          },
        });
      return;
    }

    case 'account': {
      const account = args.object as unknown as Stripe.Account;
      await tx
        .update(schema.connectedAccounts)
        .set({
          chargesEnabled: account.charges_enabled ?? false,
          payoutsEnabled: account.payouts_enabled ?? false,
          requirementsDisabledReason: account.requirements?.disabled_reason ?? null,
          rawAccount: account as unknown as Record<string, unknown>,
          syncedAt: new Date(),
        })
        .where(
          and(
            eq(schema.connectedAccounts.tenantId, args.tenantId),
            eq(schema.connectedAccounts.stripeAccountId, account.id),
          ),
        );
      return;
    }

    default:
      return;
  }
}
