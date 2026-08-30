import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, schema, withTenant, withoutTenant } from '@magic/db';
import pino from 'pino';
import { jobIdOf } from '@magic/contracts';
import { OutboxRelay } from './outbox-relay.js';

/**
 * The relay is at-least-once on purpose, so these tests check the two properties that make that
 * safe: a claimed row is published exactly once per pass, and a republish is keyed so the
 * consumer treats it as the same job rather than a second one.
 */
const OWNER_URL = process.env['DATABASE_URL_OWNER'] ?? 'postgres://magic_owner:magic_owner_password@localhost:5433/magic';
const { db, close } = createDatabase({ url: OWNER_URL, applicationName: 'magic-relay-test' });
const logger = pino({ level: 'silent' });

let tenantId: string;

beforeAll(async () => {
  tenantId = await withoutTenant(db, async (tx) => {
    const [tenant] = await tx
      .insert(schema.tenants)
      .values({ slug: `relay-${Date.now().toString(36)}`, displayName: 'Relay suite' })
      .returning({ id: schema.tenants.id });
    return tenant!.id;
  });
});

afterAll(async () => {
  /**
   * `outbox_jobs` carries a tenant id without a foreign key, so that the webhook hot path does
   * no referential check per insert. The cost is that a deleted tenant leaves its rows behind,
   * which every later run of this suite would then claim. The suite cleans up after itself.
   */
  await withoutTenant(db, async (tx) => {
    await tx.delete(schema.outboxJobs).where(eq(schema.outboxJobs.tenantId, tenantId));
    await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  });
  await close();
});

/** Restricts a relay pass to this suite's own rows, so an unrelated backlog cannot confuse it. */
async function claimableForThisTenant(): Promise<number> {
  const rows = await withoutTenant(db, async (tx) =>
    tx.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM outbox_jobs WHERE tenant_id = ${tenantId}::uuid AND published_at IS NULL`,
    ),
  );
  return Number(rows[0]?.count ?? 0);
}

type AddCall = [name: string, data: Record<string, unknown>, options: { jobId: string }];

function fakeQueue() {
  return { add: vi.fn<(...args: AddCall) => Promise<void>>(async () => undefined) };
}

/**
 * A queue name no deployed worker serves. The relay claims rows across every tenant, so a worker
 * fleet running against the same database would otherwise publish this suite's rows before the
 * suite's own relay reaches them.
 */
const TEST_QUEUE = 'test.outbox.relay';

async function seedOutbox(jobKey: string, queue = TEST_QUEUE): Promise<void> {
  await withTenant(db, { tenantId }, async (tx) => {
    await tx
      .insert(schema.outboxJobs)
      .values({ tenantId, queue, jobKey, payload: { stripeEventId: jobKey } })
      .onConflictDoNothing();
  });
}

describe('outbox relay', () => {
  it('publishes a committed row and marks it published exactly once', async () => {
    await seedOutbox('evt_relay_1');
    const queue = fakeQueue();

    const relay = new OutboxRelay({
      db,
      queues: new Map([[TEST_QUEUE, queue as never]]),
      logger,
      pollMs: 1_000,
      batchSize: 10,
    });

    expect(await claimableForThisTenant()).toBeGreaterThanOrEqual(1);

    const first = await relay.tick();
    expect(first).toBeGreaterThanOrEqual(1);
    expect(queue.add).toHaveBeenCalled();

    expect(await claimableForThisTenant()).toBe(0);
    expect(await relay.tick()).toBe(0);
  });

  it('keys the job so a republish is the same job, not a second execution', async () => {
    await seedOutbox('evt_relay_2');
    const queue = fakeQueue();

    const relay = new OutboxRelay({
      db,
      queues: new Map([[TEST_QUEUE, queue as never]]),
      logger,
      pollMs: 1_000,
      batchSize: 10,
    });

    await relay.tick();

    const call = queue.add.mock.calls.find((args) => args[2]?.jobId === jobIdOf(tenantId, 'evt_relay_2'));
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({ tenantId, stripeEventId: 'evt_relay_2' });
  });

  it('leaves a row claimable when its queue is not served by this worker role', async () => {
    await seedOutbox('evt_relay_3', 'export.generate');
    const relay = new OutboxRelay({
      db,
      queues: new Map(),
      logger,
      pollMs: 1_000,
      batchSize: 10,
    });

    const published = await relay.tick();
    expect(published).toBe(0);
    expect(await claimableForThisTenant()).toBeGreaterThanOrEqual(1);
  });

  it('stops cleanly without leaving a pass in flight', async () => {
    const relay = new OutboxRelay({
      db,
      queues: new Map([['stripe.event.process', fakeQueue() as never]]),
      logger,
      pollMs: 10,
      batchSize: 10,
    });

    relay.start();
    await relay.stop();
    expect(await relay.tick()).toBe(0);
  });
});
