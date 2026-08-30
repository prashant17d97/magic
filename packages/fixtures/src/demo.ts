import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@magic/db';
import { schema, withTenant } from '@magic/db';
import { executeRun, recomputeSettlement, runMatching } from '@magic/recon';
import { FIXTURE_NOW, SeededRandom, daysBefore, hoursBefore } from './clock.js';
import { MERCHANTS, PLATFORM_ACCOUNT } from './scenarios/accounts.js';
import { SCENARIOS } from './scenarios/all.js';
import { seedScenario, seedTenant, seedUsers } from './seeder.js';

export interface DemoResult {
  readonly tenantId: string;
  readonly slug: string;
  readonly webhookPathKey: string;
  readonly healthyCharges: number;
  readonly runs: number;
}

const PRODUCTS = [
  'Studio subscription',
  'Annual licence',
  'Workshop seat',
  'Hardware bundle',
  'Support retainer',
  'Onboarding package',
];

const DOMAINS = ['example.com', 'northwind.test', 'buyer.co', 'mail.test'];

/** The failure shapes that actually occur in a Connect platform's ledger. */
const DEFECTS = ['transfer_missing', 'transfer_short', 'fee_missing', 'refund_unreversed'] as const;
type Defect = (typeof DEFECTS)[number] | 'none';

/**
 * Layers realistic healthy traffic underneath the fixture scenarios.
 *
 * A console that only ever shows broken data is as misleading as one that shows none: an operator
 * needs to see that most payouts balance in order to judge whether the exceptions are rare or
 * routine. Every value comes from a seeded generator, so the demo is identical on every machine.
 */
async function seedHealthyTraffic(
  db: Database,
  args: { tenantId: string; orderConnectionId: string; chargeCount: number },
): Promise<number> {
  const random = new SeededRandom('northwind-healthy-traffic');
  let written = 0;

  await withTenant(db, { tenantId: args.tenantId }, async (tx) => {
    for (const merchant of MERCHANTS) {
      if (!merchant.chargesEnabled) continue;

      const perMerchant = Math.floor(args.chargeCount / MERCHANTS.length);
      const payoutId = `po_healthy_${merchant.stripeAccountId.slice(5)}`;
      let payoutNet = 0n;

      for (let i = 0; i < perMerchant; i += 1) {
        const index = written + 1;
        /**
         * A small slice of otherwise ordinary traffic is given a real defect. A console that only
         * ever shows the fourteen hand-built fixtures reads as a demo; one where a few percent of
         * a month's payments are wrong reads like the client's own account, which is the point.
         */
        const defect: Defect = random.next() < 0.09 ? random.pick(DEFECTS) : 'none';
        const chargeId = `ch_healthy_${index}`;
        const feeId = `fee_healthy_${index}`;
        const transferId = `tr_healthy_${index}`;
        const orderId = `ORD-${10_000 + index}`;
        const amount = BigInt(random.int(1_500, 480_000));
        const processing = (amount * 29n) / 1000n + 30n;
        const platformFee = (amount * 10n) / 100n;
        const merchantShare = amount - platformFee;
        const ageHours = random.int(4, 26 * 24);
        const createdAt = new Date(FIXTURE_NOW.getTime() - ageHours * 3_600_000);
        const email = `${['ava', 'noah', 'mia', 'leo', 'zoe', 'kai'][index % 6]}.${index}@${random.pick(DOMAINS)}`;

        await tx.insert(schema.charges).values({
          tenantId: args.tenantId,
          stripeAccountId: PLATFORM_ACCOUNT,
          stripeChargeId: chargeId,
          paymentIntentId: `pi_healthy_${index}`,
          balanceTransactionId: `txn_healthy_${index}`,
          amountMinor: amount,
          currency: 'USD',
          amountCapturedMinor: amount,
          status: 'succeeded',
          paid: true,
          captured: true,
          transferDestination: merchant.stripeAccountId,
          transferDataAmountMinor: merchantShare,
          transferId: defect === 'transfer_missing' ? null : transferId,
          applicationFeeId: defect === 'fee_missing' ? null : feeId,
          amountRefundedMinor: defect === 'refund_unreversed' ? amount : 0n,
          refunded: defect === 'refund_unreversed',
          paymentMethodBrand: random.pick(['visa', 'mastercard', 'amex']),
          paymentMethodLast4: String(random.int(1000, 9999)),
          customerEmail: email,
          metadata: { order_id: orderId },
          stripeCreatedAt: createdAt,
          sourceVersion: BigInt(index),
        });

        await tx.insert(schema.paymentIntents).values({
          tenantId: args.tenantId,
          stripeAccountId: PLATFORM_ACCOUNT,
          stripePaymentIntentId: `pi_healthy_${index}`,
          amountMinor: amount,
          amountReceivedMinor: amount,
          currency: 'USD',
          status: 'succeeded',
          applicationFeeAmountMinor: defect === 'fee_missing' ? null : platformFee,
          transferDestination: merchant.stripeAccountId,
          customerEmail: email,
          metadata: { order_id: orderId },
          stripeCreatedAt: createdAt,
          sourceVersion: BigInt(index),
        });

        const net = amount - processing;
        const assignedPayout = ageHours > 48 ? payoutId : null;
        if (assignedPayout) payoutNet += net;

        await tx.insert(schema.balanceTransactions).values({
          tenantId: args.tenantId,
          stripeAccountId: PLATFORM_ACCOUNT,
          stripeBtxnId: `txn_healthy_${index}`,
          type: 'charge',
          sourceId: chargeId,
          grossMinor: amount,
          feeMinor: processing,
          netMinor: net,
          currency: 'USD',
          payoutId: assignedPayout,
          availableOn: createdAt,
          stripeCreatedAt: createdAt,
          sourceVersion: BigInt(index),
        });

        if (defect !== 'transfer_missing') {
          const shortfall = defect === 'transfer_short' ? BigInt(random.int(37, 900)) : 0n;
          await tx.insert(schema.transfers).values({
            tenantId: args.tenantId,
            stripeTransferId: transferId,
            destinationAccountId: merchant.stripeAccountId,
            amountMinor: merchantShare - shortfall,
            currency: 'USD',
            sourceTransaction: chargeId,
            stripeCreatedAt: createdAt,
            sourceVersion: BigInt(index),
          });
        }

        if (defect !== 'fee_missing') {
          await tx.insert(schema.applicationFees).values({
            tenantId: args.tenantId,
            stripeFeeId: feeId,
            chargeId,
            originatingAccountId: merchant.stripeAccountId,
            amountMinor: platformFee,
            currency: 'USD',
            stripeCreatedAt: createdAt,
            sourceVersion: BigInt(index),
          });
        }

        if (defect === 'refund_unreversed') {
          await tx.insert(schema.refunds).values({
            tenantId: args.tenantId,
            stripeAccountId: PLATFORM_ACCOUNT,
            stripeRefundId: `re_healthy_${index}`,
            chargeId,
            amountMinor: amount,
            currency: 'USD',
            status: 'succeeded',
            reason: 'requested_by_customer',
            transferReversalId: null,
            stripeCreatedAt: new Date(createdAt.getTime() + 2 * 86_400_000),
            sourceVersion: BigInt(index),
          });
        }

        const [order] = await tx
          .insert(schema.orders)
          .values({
            tenantId: args.tenantId,
            sourceConnectionId: args.orderConnectionId,
            externalOrderId: orderId,
            merchantAccountId: merchant.stripeAccountId,
            totalMinor: amount,
            currency: 'USD',
            expectedPlatformFeeMinor: platformFee,
            status: 'fulfilled',
            fulfillmentStatus: 'fulfilled',
            customerEmail: email,
            paymentIntentId: `pi_healthy_${index}`,
            placedAt: new Date(createdAt.getTime() - 600_000),
            fulfilledAt: new Date(createdAt.getTime() + 86_400_000),
            syncedAt: FIXTURE_NOW,
          })
          .returning({ id: schema.orders.id });

        if (order) {
          await tx.insert(schema.orderLines).values({
            tenantId: args.tenantId,
            orderId: order.id,
            sku: `SKU-${1000 + (index % 40)}`,
            description: random.pick(PRODUCTS),
            quantity: random.int(1, 3),
            unitPriceMinor: amount,
            currency: 'USD',
          });

          await tx.insert(schema.shipments).values({
            tenantId: args.tenantId,
            orderId: order.id,
            carrier: random.pick(['ups', 'dhl', 'royal-mail']),
            trackingNumber: `TRK${random.int(100_000, 999_999)}`,
            status: 'delivered',
            shippedAt: new Date(createdAt.getTime() + 86_400_000),
            deliveredAt: new Date(createdAt.getTime() + 3 * 86_400_000),
          });
        }

        written += 1;
      }

      if (payoutNet > 0n) {
        await tx.insert(schema.payouts).values({
          tenantId: args.tenantId,
          stripeAccountId: PLATFORM_ACCOUNT,
          stripePayoutId: payoutId,
          amountMinor: payoutNet,
          currency: 'USD',
          status: 'paid',
          arrivalDate: daysBefore(1).slice(0, 10),
          automatic: true,
          stripeCreatedAt: new Date(FIXTURE_NOW.getTime() - 2 * 86_400_000),
          sourceVersion: 1n,
        });
      }
    }
  });

  return written;
}

/** Records the operational history the health dashboard reads: cursors and completeness checks. */
async function seedOperationalHistory(db: Database, tenantId: string): Promise<void> {
  const random = new SeededRandom('northwind-ops-history');

  await withTenant(db, { tenantId }, async (tx) => {
    for (const account of [{ stripeAccountId: PLATFORM_ACCOUNT }, ...MERCHANTS]) {
      for (const cursorType of ['events', 'charges', 'payouts', 'transfers']) {
        await tx
          .insert(schema.syncCursors)
          .values({
            tenantId,
            stripeAccountId: account.stripeAccountId,
            cursorType,
            lastObjectId: `evt_${cursorType}_cursor`,
            lastCreatedAt: new Date(FIXTURE_NOW.getTime() - random.int(60, 900) * 1000),
            backfillComplete: true,
            backfillFloor: new Date(FIXTURE_NOW.getTime() - 90 * 86_400_000),
            updatedAt: FIXTURE_NOW,
          })
          .onConflictDoNothing();
      }

      for (let day = 0; day < 14; day += 1) {
        const windowStart = new Date(FIXTURE_NOW.getTime() - (day + 1) * 86_400_000);
        const windowEnd = new Date(FIXTURE_NOW.getTime() - day * 86_400_000);
        const remote = random.int(40, 600);
        const drifted = account.stripeAccountId === 'acct_harbour' && day === 1;

        await tx
          .insert(schema.completenessChecks)
          .values({
            tenantId,
            stripeAccountId: account.stripeAccountId,
            objectType: 'charges',
            windowStart,
            windowEnd,
            remoteCount: remote,
            localCount: drifted ? remote - 3 : remote,
            checkedAt: windowEnd,
          })
          .onConflictDoNothing();
      }
    }
  });
}

/**
 * Builds the full demonstration tenant: every fixture scenario, realistic healthy traffic on top,
 * operational history, and a reconciliation run per scenario scope so the console opens on a
 * populated queue rather than an empty state and a README.
 */
export async function seedDemoTenant(db: Database, options: { chargeCount?: number } = {}): Promise<DemoResult> {
  const slug = 'northwind';

  const existing = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, slug))
    .limit(1);

  if (existing.length > 0) {
    throw new Error(
      `A tenant with slug "${slug}" already exists. Run "pnpm db:reset && pnpm db:migrate" before reseeding.`,
    );
  }

  const tenant = await seedTenant(db, {
    slug,
    displayName: 'Northwind Marketplace',
    timezone: 'Europe/London',
  });

  await seedUsers(db, tenant.tenantId, [
    { email: 'admin@northwind.test', displayName: 'Rae Okonkwo', role: 'admin' },
    { email: 'operator@northwind.test', displayName: 'Priya Kumar', role: 'member' },
    {
      email: 'scoped@northwind.test',
      displayName: 'Sam Delacroix',
      role: 'member',
      accountScope: ['acct_acme_studio'],
    },
    { email: 'auditor@northwind.test', displayName: 'Jonah Beck', role: 'viewer' },
  ]);

  for (const scenario of SCENARIOS) {
    await seedScenario(db, {
      tenantId: tenant.tenantId,
      orderConnectionId: tenant.orderConnectionId,
      scenario,
    });
  }

  const healthyCharges = await seedHealthyTraffic(db, {
    tenantId: tenant.tenantId,
    orderConnectionId: tenant.orderConnectionId,
    chargeCount: options.chargeCount ?? 600,
  });

  await withTenant(db, { tenantId: tenant.tenantId }, async (tx) => {
    const charges = await tx
      .select({ id: schema.charges.stripeChargeId })
      .from(schema.charges)
      .where(eq(schema.charges.tenantId, tenant.tenantId));

    for (const charge of charges) {
      await recomputeSettlement(tx, {
        tenantId: tenant.tenantId,
        platformAccountId: PLATFORM_ACCOUNT,
        chargeId: charge.id,
      });
    }

    await runMatching(tx, {
      tenantId: tenant.tenantId,
      from: new Date(FIXTURE_NOW.getTime() - 60 * 86_400_000),
      to: new Date(FIXTURE_NOW.getTime() + 86_400_000),
    });
  });

  await seedOperationalHistory(db, tenant.tenantId);

  const scopes = new Map<string, { accountId: string; payoutId: string | null; mode: 'transactional' | 'aggregate' }>();
  for (const scenario of SCENARIOS) {
    scopes.set(`${scenario.runAccountId}:${scenario.runPayoutId ?? 'window'}`, {
      accountId: scenario.runAccountId,
      payoutId: scenario.runPayoutId,
      mode: scenario.mode,
    });
  }
  for (const merchant of MERCHANTS) {
    if (!merchant.chargesEnabled) continue;
    scopes.set(`healthy:${merchant.stripeAccountId}`, {
      accountId: PLATFORM_ACCOUNT,
      payoutId: `po_healthy_${merchant.stripeAccountId.slice(5)}`,
      mode: 'transactional',
    });
  }

  scopes.set(`window:${PLATFORM_ACCOUNT}`, {
    accountId: PLATFORM_ACCOUNT,
    payoutId: null,
    mode: 'transactional',
  });
  for (const merchant of MERCHANTS) {
    scopes.set(`window:${merchant.stripeAccountId}`, {
      accountId: merchant.stripeAccountId,
      payoutId: null,
      mode: 'aggregate',
    });
  }

  let runs = 0;
  for (const scope of scopes.values()) {
    await executeRun(db, {
      tenantId: tenant.tenantId,
      stripeAccountId: scope.accountId,
      platformAccountId: PLATFORM_ACCOUNT,
      payoutId: scope.payoutId,
      windowStart: new Date(FIXTURE_NOW.getTime() - 30 * 86_400_000),
      windowEnd: new Date(FIXTURE_NOW.getTime() + 86_400_000),
      mode: scope.mode,
      triggeredBy: 'schedule',
      asOf: FIXTURE_NOW,
    });
    runs += 1;
  }

  await seedWorkflowHistory(db, tenant.tenantId);
  await backdateFindings(db, tenant.tenantId);

  return {
    tenantId: tenant.tenantId,
    slug,
    webhookPathKey: tenant.webhookPathKey,
    healthyCharges,
    runs,
  };
}

/**
 * Back-dates every finding to the moment its subject actually became observable.
 *
 * A reconciliation run stamps `first_seen_at` at the instant it executes, so seeding the whole
 * corpus in one pass leaves thirty days of history collapsed onto a single day and the trend
 * chart reading as one spike against a flat line. The charges themselves are already spread over
 * the window, so each finding is anchored to its own subject: a charge discrepancy dates from the
 * charge, an order discrepancy from the order, a payout discrepancy from the payout.
 *
 * A finding with no datable subject falls back to a spread derived from its own id, which keeps
 * the result identical across re-seeds rather than moving every time the demo is rebuilt.
 */
async function backdateFindings(db: Database, tenantId: string): Promise<void> {
  await withTenant(db, { tenantId }, async (tx) => {
    await tx.execute(sql`
      UPDATE exceptions e
         SET first_seen_at = a.seen,
             last_seen_at = GREATEST(a.seen, LEAST(${FIXTURE_NOW.toISOString()}::timestamptz, a.seen + interval '2 days'))
        FROM (
          SELECT x.id,
                 COALESCE(c.stripe_created_at, o.placed_at, p.stripe_created_at,
                          ${FIXTURE_NOW.toISOString()}::timestamptz
                            - (('x' || substr(md5(x.id::text), 1, 8))::bit(32)::bigint % 28) * interval '1 day')
                   AS seen
            FROM exceptions x
            LEFT JOIN charges c ON c.tenant_id = x.tenant_id AND c.stripe_charge_id = x.subject_id
            LEFT JOIN orders  o ON o.tenant_id = x.tenant_id AND o.external_order_id = x.subject_id
            LEFT JOIN payouts p ON p.tenant_id = x.tenant_id AND p.stripe_payout_id = x.subject_id
           WHERE x.tenant_id = ${tenantId}::uuid
        ) a
       WHERE e.id = a.id AND e.tenant_id = ${tenantId}::uuid
    `);

    /**
     * A finding is resolved some hours after it was raised, never before it and never in the
     * future, so the resolved series trails the opened one the way a worked queue does.
     */
    await tx.execute(sql`
      UPDATE exceptions
         SET resolved_at = LEAST(
               ${FIXTURE_NOW.toISOString()}::timestamptz,
               first_seen_at + ((('x' || substr(md5(id::text), 9, 8))::bit(32)::bigint % 60) + 4) * interval '1 hour'
             )
       WHERE tenant_id = ${tenantId}::uuid
         AND status IN ('resolved', 'ignored')
    `);
  });
}

/**
 * Gives the queue a lived-in look: some findings assigned, some already worked, a saved view and
 * an export. An operator evaluating the tool should see what a week of use looks like.
 */
async function seedWorkflowHistory(db: Database, tenantId: string): Promise<void> {
  await withTenant(db, { tenantId }, async (tx) => {
    const users = await tx.select().from(schema.users);
    const operator = users.find((u) => u.email === 'operator@northwind.test');
    const admin = users.find((u) => u.email === 'admin@northwind.test');
    if (!operator || !admin) return;

    const open = await tx
      .select()
      .from(schema.exceptions)
      .where(and(eq(schema.exceptions.tenantId, tenantId), eq(schema.exceptions.status, 'open')));

    for (const [index, exception] of open.entries()) {
      if (index % 4 === 1) {
        await tx
          .update(schema.exceptions)
          .set({ status: 'investigating', assignedTo: operator.id })
          .where(eq(schema.exceptions.id, exception.id));
        await tx.insert(schema.exceptionEvents).values({
          tenantId,
          exceptionId: exception.id,
          fromStatus: 'open',
          toStatus: 'investigating',
          actorUserId: operator.id,
          actorType: 'user',
          note: 'Picked up during the morning queue review.',
        });
      }

      if (index % 7 === 3) {
        await tx
          .update(schema.exceptions)
          .set({
            status: 'ignored',
            resolvedAt: new Date(FIXTURE_NOW.getTime() - 3_600_000),
            resolvedBy: operator.id,
            resolutionNote: 'Known timing difference on this merchant; confirmed with the payments team.',
          })
          .where(eq(schema.exceptions.id, exception.id));
        await tx.insert(schema.exceptionEvents).values({
          tenantId,
          exceptionId: exception.id,
          fromStatus: 'open',
          toStatus: 'ignored',
          actorUserId: operator.id,
          actorType: 'user',
          note: 'Known timing difference on this merchant; confirmed with the payments team.',
        });
      }
    }

    await tx.insert(schema.savedViews).values([
      {
        tenantId,
        ownerUserId: operator.id,
        name: 'Critical, unassigned',
        resource: 'exceptions',
        query: { status: ['open'], severity: ['critical'], sort: 'exposure_minor', direction: 'desc' },
        shared: true,
      },
      {
        tenantId,
        ownerUserId: operator.id,
        name: 'My investigations',
        resource: 'exceptions',
        query: { status: ['investigating'], assignee_id: operator.id },
        shared: false,
      },
      {
        tenantId,
        ownerUserId: admin.id,
        name: 'Unmatched settlements',
        resource: 'settlements',
        query: { match_tier: 'unmatched' },
        shared: true,
      },
    ]);

    await tx.insert(schema.exports).values({
      tenantId,
      requestedBy: admin.id,
      kind: 'exceptions',
      format: 'csv',
      filters: { status: ['open'] },
      status: 'ready',
      rowCount: open.length,
      objectKey: `exports/${tenantId}/open-exceptions.csv`,
      expiresAt: new Date(FIXTURE_NOW.getTime() + 900_000),
      createdAt: new Date(FIXTURE_NOW.getTime() - 1_800_000),
    });

    await tx.insert(schema.auditLog).values([
      {
        tenantId,
        actorUserId: admin.id,
        actorType: 'user',
        action: 'connection.create',
        resourceType: 'stripe_connection',
        resourceId: PLATFORM_ACCOUNT,
        after: { status: 'active', livemode: false },
        ipAddress: '203.0.113.24',
        requestId: 'req_seed_0001',
        createdAt: new Date(Date.parse(hoursBefore(72))),
      },
      {
        tenantId,
        actorUserId: admin.id,
        actorType: 'user',
        action: 'rule.update',
        resourceType: 'rule',
        resourceId: 'L2.DEST.TRANSFER_AMOUNT',
        before: { parameters: { tolerance_minor: 0 } },
        after: { parameters: { tolerance_minor: 2 } },
        ipAddress: '203.0.113.24',
        requestId: 'req_seed_0002',
        createdAt: new Date(Date.parse(hoursBefore(20))),
      },
    ]);
  });
}
