import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDatabase, schema, withTenant, withoutTenant } from '@magic/db';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

/**
 * These four cases encode the security claims the endpoint makes. Each one is blocking in CI,
 * because a claim that is not tested on every commit eventually stops being true.
 */
const OWNER_URL = process.env['DATABASE_URL_OWNER'] ?? 'postgres://magic_owner:magic_owner_password@localhost:5433/magic';
const SIGNING_SECRET = 'whsec_test_secret_for_ingest_suite';

const { db, close } = createDatabase({ url: OWNER_URL, applicationName: 'magic-ingest-test' });

let app: FastifyInstance;
let tenantId: string;
let pathKey: string;

function signedHeaders(payload: string, secret = SIGNING_SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function eventPayload(id: string, type = 'charge.succeeded'): string {
  return JSON.stringify({
    id,
    object: 'event',
    api_version: '2026-06-30',
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object: { id: 'ch_ingest_1', object: 'charge' } },
  });
}

beforeAll(async () => {
  process.env['STRIPE_WEBHOOK_SECRET_TEST'] = SIGNING_SECRET;

  const created = await withoutTenant(db, async (tx) => {
    const [tenant] = await tx
      .insert(schema.tenants)
      .values({ slug: `ingest-${Date.now().toString(36)}`, displayName: 'Ingest suite' })
      .returning({ id: schema.tenants.id });

    const key = `whk_ingest_${Date.now().toString(36)}`;
    await tx.insert(schema.stripeConnections).values({
      tenantId: tenant!.id,
      stripeAccountId: 'acct_ingest_platform',
      livemode: false,
      webhookPathKey: key,
      webhookSecretRef: 'STRIPE_WEBHOOK_SECRET_TEST',
      apiKeyRef: 'STRIPE_PLATFORM_API_KEY',
    });

    return { tenantId: tenant!.id, key };
  });

  tenantId = created.tenantId;
  pathKey = created.key;

  app = buildServer({
    config: loadConfig({
      ...process.env,
      DATABASE_URL: OWNER_URL,
      REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6380',
      LOG_LEVEL: 'fatal',
    }),
    db,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  /**
   * `outbox_jobs` carries a tenant id without a foreign key, so deleting the tenant leaves its
   * rows behind on a live queue name, where a running worker fleet would claim them and
   * dead-letter events that only ever existed for this suite.
   */
  await withoutTenant(db, async (tx) => {
    await tx.delete(schema.outboxJobs).where(eq(schema.outboxJobs.tenantId, tenantId));
    await tx.delete(schema.stripeEvents).where(eq(schema.stripeEvents.tenantId, tenantId));
    await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  });
  await close();
});

async function post(body: string, headers: Record<string, string>, key = pathKey) {
  return app.inject({
    method: 'POST',
    url: `/wh/stripe/${key}`,
    headers: { 'content-type': 'application/json', ...headers },
    payload: body,
  });
}

describe('webhook endpoint', () => {
  it('accepts a correctly signed event and writes it with its outbox job atomically', async () => {
    const payload = eventPayload('evt_ingest_accept_1');
    const response = await post(payload, { 'stripe-signature': signedHeaders(payload) });

    expect(response.statusCode).toBe(200);

    const stored = await withTenant(db, { tenantId }, async (tx) => ({
      events: await tx.select().from(schema.stripeEvents).where(eq(schema.stripeEvents.tenantId, tenantId)),
      jobs: await tx.select().from(schema.outboxJobs).where(eq(schema.outboxJobs.tenantId, tenantId)),
    }));

    expect(stored.events).toHaveLength(1);
    expect(stored.jobs).toHaveLength(1);
    expect(stored.jobs[0]?.jobKey).toBe('evt_ingest_accept_1');
  });

  it('treats a repeat delivery as a no-op rather than a second event', async () => {
    const payload = eventPayload('evt_ingest_accept_1');
    const response = await post(payload, { 'stripe-signature': signedHeaders(payload) });

    expect(response.statusCode).toBe(200);

    const events = await withTenant(db, { tenantId }, async (tx) =>
      tx.select().from(schema.stripeEvents).where(eq(schema.stripeEvents.tenantId, tenantId)),
    );
    expect(events).toHaveLength(1);
  });

  it('rejects a bad signature with a bare 400 that leaks no detail', async () => {
    const payload = eventPayload('evt_ingest_badsig_1');
    const response = await post(payload, { 'stripe-signature': signedHeaders(payload, 'whsec_wrong_secret') });

    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('');
  });

  it('rejects a replayed signature outside the tolerance window', async () => {
    const payload = eventPayload('evt_ingest_replay_1');
    const stale = Math.floor(Date.now() / 1000) - 7_200;
    const response = await post(payload, { 'stripe-signature': signedHeaders(payload, SIGNING_SECRET, stale) });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a tampered body even when the signature header is well formed', async () => {
    const payload = eventPayload('evt_ingest_tamper_1');
    const signature = signedHeaders(payload);
    const tampered = payload.replace('ch_ingest_1', 'ch_attacker');
    const response = await post(tampered, { 'stripe-signature': signature });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for an unknown path key, giving no oracle for valid tenants', async () => {
    const payload = eventPayload('evt_ingest_unknown_1');
    const response = await post(payload, { 'stripe-signature': signedHeaders(payload) }, 'whk_does_not_exist');

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('');
  });

  it('rejects a request with no signature header at all', async () => {
    const response = await post(eventPayload('evt_ingest_nosig_1'), {});
    expect(response.statusCode).toBe(400);
  });

  it('serves liveness and metrics without touching the database', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);

    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('webhook_received_total');
    expect(metrics.body).toContain('webhook_signature_failures_total');
  });
});
