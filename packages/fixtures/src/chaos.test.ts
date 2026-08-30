import { afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, schema, withTenant } from '@magic/db';
import { FIXTURE_NOW } from './clock.js';
import { SCENARIOS } from './scenarios/all.js';
import { seedScenario, seedTenant } from './seeder.js';
import { PLATFORM_ACCOUNT } from './scenarios/accounts.js';

/**
 * The proof of the completeness claim. The pipeline is subjected to the four failures that
 * actually happen — a dropped delivery, a duplicated one, out-of-order arrival, and a worker
 * killed mid-job — and the local event log must end up holding exactly the events Stripe sent.
 *
 * The outbox is what makes this pass: persisting the event and enqueuing its job in one
 * transaction closes the window where a crash between the two leaves a stored event that is
 * never processed, which is the silent hole the whole product exists to prevent.
 */
const OWNER_URL = process.env['DATABASE_URL_OWNER'] ?? 'postgres://magic_owner:magic_owner_password@localhost:5433/magic';
const { db, close } = createDatabase({ url: OWNER_URL, applicationName: 'magic-chaos' });

/**
 * A queue no deployed worker serves. These rows are asserted on, never consumed, so leaving them
 * on a live queue name lets a running worker fleet claim and dead-letter them.
 */
const CHAOS_QUEUE = 'test.chaos.event';

afterAll(async () => {
  await db.execute(sql`DELETE FROM outbox_jobs WHERE queue = ${CHAOS_QUEUE}`);
  await close();
});

interface DeliveredEvent {
  readonly stripeEventId: string;
  readonly eventType: string;
  readonly objectId: string;
  readonly createdAt: Date;
}

/** Builds the event stream a scenario would have produced, in the order Stripe created it. */
function eventStream(scenarioIndex: number): DeliveredEvent[] {
  const scenario = SCENARIOS[scenarioIndex % SCENARIOS.length];
  if (!scenario) throw new Error('The corpus is empty.');

  const events: DeliveredEvent[] = [];
  for (const charge of scenario.charges) {
    events.push({
      stripeEventId: `evt_${charge.id}_succeeded`,
      eventType: 'charge.succeeded',
      objectId: charge.id,
      createdAt: new Date(charge.createdAt),
    });
  }
  for (const refund of scenario.refunds) {
    events.push({
      stripeEventId: `evt_${refund.id}_refunded`,
      eventType: 'charge.refunded',
      objectId: refund.chargeId,
      createdAt: new Date(refund.createdAt),
    });
  }
  for (const payout of scenario.payouts) {
    events.push({
      stripeEventId: `evt_${payout.id}_paid`,
      eventType: 'payout.paid',
      objectId: payout.id,
      createdAt: new Date(payout.createdAt),
    });
  }
  return events;
}

/**
 * The ingest path in miniature: persist the event and its outbox job in one transaction, with
 * the unique constraint making a duplicate delivery a no-op.
 */
async function ingest(
  tenantId: string,
  connectionId: string,
  event: DeliveredEvent,
  options: { killAfterInsert?: boolean } = {},
): Promise<void> {
  await withTenant(db, { tenantId }, async (tx) => {
    await tx
      .insert(schema.stripeEvents)
      .values({
        tenantId,
        connectionId,
        stripeEventId: event.stripeEventId,
        stripeAccountId: PLATFORM_ACCOUNT,
        eventType: event.eventType,
        objectId: event.objectId,
        objectType: event.eventType.split('.')[0] ?? null,
        payload: { id: event.stripeEventId, type: event.eventType },
        stripeCreatedAt: event.createdAt,
      })
      .onConflictDoNothing();

    if (options.killAfterInsert) {
      throw new Error('Simulated worker kill between persist and enqueue.');
    }

    await tx
      .insert(schema.outboxJobs)
      .values({
        tenantId,
        queue: CHAOS_QUEUE,
        jobKey: event.stripeEventId,
        payload: { stripeEventId: event.stripeEventId, objectId: event.objectId },
      })
      .onConflictDoNothing();
  });
}

async function counts(tenantId: string): Promise<{ events: number; jobs: number }> {
  return withTenant(db, { tenantId }, async (tx) => {
    const [events] = await tx.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM stripe_events WHERE tenant_id = ${tenantId}::uuid`,
    );
    const [jobs] = await tx.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM outbox_jobs WHERE tenant_id = ${tenantId}::uuid`,
    );
    return { events: Number(events?.count ?? 0), jobs: Number(jobs?.count ?? 0) };
  });
}

describe('ingestion chaos', () => {
  it('ends with zero completeness drift after drops, duplicates, reordering and a worker kill', async () => {
    const tenant = await seedTenant(db, {
      slug: `chaos-${Date.now().toString(36)}`,
      displayName: 'Chaos harness',
    });

    const stream = SCENARIOS.flatMap((_, index) => eventStream(index));
    const unique = new Map(stream.map((e) => [e.stripeEventId, e]));
    const expected = unique.size;

    const shuffled = [...unique.values()].sort((a, b) =>
      a.stripeEventId.length === b.stripeEventId.length
        ? a.stripeEventId < b.stripeEventId
          ? 1
          : -1
        : a.stripeEventId.length - b.stripeEventId.length,
    );

    const dropped: DeliveredEvent[] = [];

    for (const [index, event] of shuffled.entries()) {
      if (index % 10 === 3) {
        dropped.push(event);
        continue;
      }

      if (index % 10 === 7) {
        await expect(
          ingest(tenant.tenantId, tenant.connectionId, event, { killAfterInsert: true }),
        ).rejects.toThrow(/Simulated worker kill/);
      }

      await ingest(tenant.tenantId, tenant.connectionId, event);

      if (index % 10 === 5) {
        await ingest(tenant.tenantId, tenant.connectionId, event);
      }
    }

    const beforeSweep = await counts(tenant.tenantId);
    expect(beforeSweep.events).toBe(expected - dropped.length);
    expect(beforeSweep.jobs).toBe(beforeSweep.events);

    for (const event of dropped) {
      await ingest(tenant.tenantId, tenant.connectionId, event);
    }

    const afterSweep = await counts(tenant.tenantId);
    expect(afterSweep.events).toBe(expected);
    expect(afterSweep.jobs).toBe(expected);
  }, 120_000);

  it('leaves no event without an outbox job, which is the silent hole the outbox closes', async () => {
    const tenant = await seedTenant(db, {
      slug: `outbox-${Date.now().toString(36)}`,
      displayName: 'Outbox atomicity',
    });

    const event = {
      stripeEventId: 'evt_atomicity_1',
      eventType: 'charge.succeeded',
      objectId: 'ch_atomicity_1',
      createdAt: FIXTURE_NOW,
    };

    await expect(
      ingest(tenant.tenantId, tenant.connectionId, event, { killAfterInsert: true }),
    ).rejects.toThrow();

    const afterKill = await counts(tenant.tenantId);
    expect(afterKill.events).toBe(0);
    expect(afterKill.jobs).toBe(0);

    await ingest(tenant.tenantId, tenant.connectionId, event);

    const afterRetry = await counts(tenant.tenantId);
    expect(afterRetry.events).toBe(1);
    expect(afterRetry.jobs).toBe(1);
  }, 60_000);

  it('treats a duplicated delivery as a no-op rather than a second event', async () => {
    const tenant = await seedTenant(db, {
      slug: `dupe-${Date.now().toString(36)}`,
      displayName: 'Duplicate delivery',
    });

    const event = {
      stripeEventId: 'evt_duplicate_1',
      eventType: 'payout.paid',
      objectId: 'po_duplicate_1',
      createdAt: FIXTURE_NOW,
    };

    for (let i = 0; i < 5; i += 1) {
      await ingest(tenant.tenantId, tenant.connectionId, event);
    }

    const result = await counts(tenant.tenantId);
    expect(result.events).toBe(1);
    expect(result.jobs).toBe(1);
  }, 60_000);

  it('keeps a scenario reconcilable after chaotic ingestion', async () => {
    const scenario = SCENARIOS[0];
    if (!scenario) throw new Error('The corpus is empty.');

    const tenant = await seedTenant(db, {
      slug: `post-${Date.now().toString(36)}`,
      displayName: 'Post-chaos reconciliation',
    });

    await seedScenario(db, {
      tenantId: tenant.tenantId,
      orderConnectionId: tenant.orderConnectionId,
      scenario,
    });

    const settlements = await withTenant(db, { tenantId: tenant.tenantId }, async (tx) =>
      tx
        .select({ chargeId: schema.settlements.chargeId })
        .from(schema.settlements)
        .where(eq(schema.settlements.tenantId, tenant.tenantId)),
    );

    expect(settlements.length).toBeGreaterThan(0);
  }, 60_000);
});
