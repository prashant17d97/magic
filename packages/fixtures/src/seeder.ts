import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '@magic/db';
import { schema, withTenant } from '@magic/db';
import { executeRun, recomputeSettlement, runMatching } from '@magic/recon';
import { hashPassword } from '@magic/security';
import { FIXTURE_NOW } from './clock.js';
import { ACCOUNTS, PLATFORM_ACCOUNT } from './scenarios/accounts.js';
import type { Scenario } from './types.js';

export interface SeedTenantOptions {
  readonly slug: string;
  readonly displayName: string;
  readonly timezone?: string;
}

export interface SeededTenant {
  readonly tenantId: string;
  readonly connectionId: string;
  readonly orderConnectionId: string;
  readonly webhookPathKey: string;
}

/** Every seeded operator shares one development password. It is never a real credential. */
export const SEED_PASSWORD = 'magic-dev-password';

/**
 * Creates a tenant with its Stripe connection, connected accounts, an order source, and the
 * three seat roles. Secrets are stored as references only — a fixture database therefore holds
 * no credential, real or fake, that could be mistaken for one.
 */
export async function seedTenant(db: Database, options: SeedTenantOptions): Promise<SeededTenant> {
  const tenantId = randomUUID();

  return withTenant(db, { tenantId }, async (tx) => {
    await tx.insert(schema.tenants).values({
      id: tenantId,
      slug: options.slug,
      displayName: options.displayName,
      timezone: options.timezone ?? 'UTC',
    });

    const webhookPathKey = `whk_${options.slug.replace(/[^a-z0-9]/g, '')}_${tenantId.slice(0, 8)}`;

    const [connection] = await tx
      .insert(schema.stripeConnections)
      .values({
        tenantId,
        stripeAccountId: PLATFORM_ACCOUNT,
        livemode: false,
        webhookPathKey,
        webhookSecretRef: 'STRIPE_WEBHOOK_SECRET',
        apiKeyRef: 'STRIPE_PLATFORM_API_KEY',
        takeRateBps: 1000,
      })
      .returning({ id: schema.stripeConnections.id });

    const connectionId = connection?.id;
    if (!connectionId) throw new Error('Failed to create the fixture Stripe connection.');

    for (const account of ACCOUNTS) {
      await tx.insert(schema.connectedAccounts).values({
        tenantId,
        connectionId,
        stripeAccountId: account.stripeAccountId,
        accountType: account.accountType,
        displayName: account.displayName,
        country: account.country,
        defaultCurrency: account.currency,
        chargesEnabled: account.chargesEnabled,
        payoutsEnabled: account.payoutsEnabled,
        requirementsDisabledReason: account.requirementsDisabledReason,
        syncedAt: FIXTURE_NOW,
      });
    }

    const [orderConnection] = await tx
      .insert(schema.orderSourceConnections)
      .values({
        tenantId,
        adapter: 'mock',
        displayName: 'Reference order source',
        config: { seeded: true },
        lastSyncedAt: FIXTURE_NOW,
      })
      .returning({ id: schema.orderSourceConnections.id });

    const orderConnectionId = orderConnection?.id;
    if (!orderConnectionId) throw new Error('Failed to create the fixture order source.');

    return { tenantId, connectionId, orderConnectionId, webhookPathKey };
  });
}

export interface SeedUserSpec {
  readonly email: string;
  readonly displayName: string;
  readonly role: 'admin' | 'member' | 'viewer';
  readonly passwordHash?: string;
  readonly accountScope?: string[] | null;
}

export async function seedUsers(db: Database, tenantId: string, users: readonly SeedUserSpec[]): Promise<void> {
  await withTenant(db, { tenantId }, async (tx) => {
    for (const spec of users) {
      const [existing] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, spec.email))
        .limit(1);

      const userId =
        existing?.id ??
        (
          await tx
            .insert(schema.users)
            .values({
              email: spec.email,
              displayName: spec.displayName,
              passwordHash: spec.passwordHash ?? (await hashPassword(SEED_PASSWORD)),
            })
            .returning({ id: schema.users.id })
        )[0]?.id;

      if (!userId) throw new Error(`Failed to create fixture user ${spec.email}.`);

      await tx
        .insert(schema.memberships)
        .values({
          tenantId,
          userId,
          role: spec.role,
          accountScope: spec.accountScope ?? null,
        })
        .onConflictDoNothing();
    }
  });
}

/**
 * Writes one scenario's objects, recomputes the settlements they imply, and runs matching.
 * Reconciliation is deliberately a separate step so a caller can seed several scenarios and
 * then run once, exactly as production would after a batch of webhooks.
 */
export async function seedScenario(
  db: Database,
  args: { tenantId: string; orderConnectionId: string; scenario: Scenario },
): Promise<void> {
  const { tenantId, scenario } = args;

  await withTenant(db, { tenantId }, async (tx) => {
    let version = 1n;
    const nextVersion = (): bigint => (version += 1n);

    for (const charge of scenario.charges) {
      await tx.insert(schema.charges).values({
        tenantId,
        stripeAccountId: charge.accountId,
        stripeChargeId: charge.id,
        paymentIntentId: charge.paymentIntentId,
        balanceTransactionId: charge.balanceTransactionId,
        amountMinor: charge.amountMinor,
        currency: charge.currency,
        amountRefundedMinor: charge.refundedMinor ?? 0n,
        amountCapturedMinor: charge.amountMinor,
        status: charge.status ?? 'succeeded',
        paid: true,
        refunded: (charge.refundedMinor ?? 0n) >= charge.amountMinor,
        disputed: false,
        captured: true,
        onBehalfOf: charge.onBehalfOf ?? null,
        transferDestination: charge.transferDestination ?? null,
        transferDataAmountMinor: charge.transferDataAmountMinor ?? null,
        transferId: charge.transferId ?? null,
        applicationFeeId: charge.applicationFeeId ?? null,
        sourceTransferId: charge.sourceTransferId ?? null,
        paymentMethodBrand: 'visa',
        paymentMethodLast4: '4242',
        customerEmail: charge.customerEmail ?? null,
        metadata: charge.metadata ?? {},
        stripeCreatedAt: new Date(charge.createdAt),
        sourceVersion: nextVersion(),
      });

      if (charge.paymentIntentId) {
        await tx
          .insert(schema.paymentIntents)
          .values({
            tenantId,
            stripeAccountId: charge.accountId,
            stripePaymentIntentId: charge.paymentIntentId,
            amountMinor: charge.amountMinor,
            amountReceivedMinor: charge.amountMinor,
            currency: charge.currency,
            status: 'succeeded',
            onBehalfOf: charge.onBehalfOf ?? null,
            transferDestination: charge.transferDestination ?? null,
            customerEmail: charge.customerEmail ?? null,
            metadata: charge.metadata ?? {},
            stripeCreatedAt: new Date(charge.createdAt),
            sourceVersion: nextVersion(),
          })
          .onConflictDoNothing();
      }
    }

    for (const txn of scenario.balanceTransactions) {
      await tx.insert(schema.balanceTransactions).values({
        tenantId,
        stripeAccountId: txn.accountId,
        stripeBtxnId: txn.id,
        type: txn.type,
        sourceId: txn.sourceId,
        grossMinor: txn.grossMinor,
        feeMinor: txn.feeMinor,
        netMinor: txn.netMinor,
        currency: txn.currency,
        payoutId: txn.payoutId,
        availableOn: new Date(txn.createdAt),
        stripeCreatedAt: new Date(txn.createdAt),
        sourceVersion: nextVersion(),
      });
    }

    for (const payout of scenario.payouts) {
      await tx.insert(schema.payouts).values({
        tenantId,
        stripeAccountId: payout.accountId,
        stripePayoutId: payout.id,
        amountMinor: payout.amountMinor,
        currency: payout.currency,
        status: payout.status,
        arrivalDate: payout.arrivalDate,
        automatic: true,
        stripeCreatedAt: new Date(payout.createdAt),
        sourceVersion: nextVersion(),
      });
    }

    for (const refund of scenario.refunds) {
      await tx.insert(schema.refunds).values({
        tenantId,
        stripeAccountId: refund.accountId,
        stripeRefundId: refund.id,
        chargeId: refund.chargeId,
        amountMinor: refund.amountMinor,
        currency: refund.currency,
        status: refund.status ?? 'succeeded',
        reason: refund.reason ?? null,
        transferReversalId: refund.transferReversalId ?? null,
        stripeCreatedAt: new Date(refund.createdAt),
        sourceVersion: nextVersion(),
      });
    }

    for (const transfer of scenario.transfers) {
      await tx.insert(schema.transfers).values({
        tenantId,
        stripeTransferId: transfer.id,
        destinationAccountId: transfer.destinationAccountId,
        amountMinor: transfer.amountMinor,
        amountReversedMinor: transfer.reversedMinor ?? 0n,
        currency: transfer.currency,
        sourceTransaction: transfer.sourceTransaction,
        stripeCreatedAt: new Date(transfer.createdAt),
        sourceVersion: nextVersion(),
      });
    }

    for (const reversal of scenario.reversals) {
      await tx.insert(schema.transferReversals).values({
        tenantId,
        stripeReversalId: reversal.id,
        transferId: reversal.transferId,
        amountMinor: reversal.amountMinor,
        currency: reversal.currency,
        stripeCreatedAt: new Date(reversal.createdAt),
        sourceVersion: nextVersion(),
      });
    }

    for (const fee of scenario.applicationFees) {
      await tx.insert(schema.applicationFees).values({
        tenantId,
        stripeFeeId: fee.id,
        chargeId: fee.chargeId,
        originatingAccountId: fee.originatingAccountId,
        amountMinor: fee.amountMinor,
        amountRefundedMinor: fee.refundedMinor ?? 0n,
        currency: fee.currency,
        refunded: (fee.refundedMinor ?? 0n) > 0n,
        stripeCreatedAt: new Date(fee.createdAt),
        sourceVersion: nextVersion(),
      });
    }

    for (const dispute of scenario.disputes) {
      await tx.insert(schema.disputes).values({
        tenantId,
        stripeAccountId: dispute.accountId,
        stripeDisputeId: dispute.id,
        chargeId: dispute.chargeId,
        amountMinor: dispute.amountMinor,
        currency: dispute.currency,
        status: dispute.status,
        reason: dispute.reason,
        stripeCreatedAt: new Date(dispute.createdAt),
        sourceVersion: nextVersion(),
      });
    }

    for (const order of scenario.orders) {
      await tx
        .insert(schema.orders)
        .values({
          tenantId,
          sourceConnectionId: args.orderConnectionId,
          externalOrderId: order.externalOrderId,
          merchantAccountId: order.merchantAccountId,
          totalMinor: order.totalMinor,
          currency: order.currency,
          expectedPlatformFeeMinor: order.expectedPlatformFeeMinor,
          status: order.status,
          fulfillmentStatus: order.fulfillmentStatus,
          customerEmail: order.customerEmail,
          paymentIntentId: order.paymentIntentId,
          placedAt: new Date(order.placedAt),
          fulfilledAt: order.fulfilledAt ? new Date(order.fulfilledAt) : null,
          cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null,
          syncedAt: FIXTURE_NOW,
        })
        .onConflictDoNothing();
    }

    for (const charge of scenario.charges) {
      await recomputeSettlement(tx, {
        tenantId,
        platformAccountId: PLATFORM_ACCOUNT,
        chargeId: charge.id,
      });
    }

    await runMatching(tx, {
      tenantId,
      from: new Date(FIXTURE_NOW.getTime() - 60 * 86_400_000),
      to: new Date(FIXTURE_NOW.getTime() + 86_400_000),
    });
  });
}

/** Runs reconciliation over a scenario's declared scope and returns the rule ids it produced. */
export async function reconcileScenario(
  db: Database,
  args: { tenantId: string; scenario: Scenario },
): Promise<{ runId: string; ruleIds: string[] }> {
  const { scenario } = args;

  const outcome = await executeRun(db, {
    tenantId: args.tenantId,
    stripeAccountId: scenario.runAccountId,
    platformAccountId: PLATFORM_ACCOUNT,
    payoutId: scenario.runPayoutId,
    windowStart: new Date(FIXTURE_NOW.getTime() - 30 * 86_400_000),
    windowEnd: new Date(FIXTURE_NOW.getTime() + 86_400_000),
    mode: scenario.mode,
    triggeredBy: 'schedule',
    asOf: FIXTURE_NOW,
  });

  const ruleIds = await withTenant(db, { tenantId: args.tenantId }, async (tx) => {
    const rows = await tx
      .select({ ruleId: schema.exceptions.ruleId })
      .from(schema.exceptions)
      .where(
        and(
          eq(schema.exceptions.tenantId, args.tenantId),
          eq(schema.exceptions.lastSeenRunId, outcome.runId),
        ),
      );
    return [...new Set(rows.map((r) => r.ruleId))].sort();
  });

  return { runId: outcome.runId, ruleIds };
}
