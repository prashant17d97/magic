import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Database } from '@magic/db';
import { schema, withTenant } from '@magic/db';
import {
  CachedSecretsProvider,
  EnvSecretsProvider,
  type SecretsProvider,
  eventObjectRef,
  verifyWebhook,
} from '@magic/stripe-client';
import type { IngestConfig } from './config.js';
import { ConnectionCache } from './connection-cache.js';
import { metrics, renderMetrics } from './metrics.js';

export interface ServerDeps {
  readonly config: IngestConfig;
  readonly db: Database;
  readonly secrets?: SecretsProvider;
}

/**
 * The webhook endpoint. The order of the steps below is the security property, not a style:
 *
 *   1. Tenant comes from the URL path, never the body. The body is untrusted until step 3, and
 *      reading it first is the whole attack.
 *   2. The raw body is used for verification. Any JSON parse beforehand invalidates the
 *      signature — the most common Stripe integration bug, and a security failure as well as a
 *      correctness one.
 *   3. Persisting the event and enqueuing its job happen in one transaction. Two statements would
 *      leave a window where a crash after the commit stores an event nobody ever processes: a
 *      silent hole, which is exactly the failure this product exists to prevent.
 */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const { config, db } = deps;
  const secrets = new CachedSecretsProvider(deps.secrets ?? new EnvSecretsProvider(), 300_000);
  const connections = new ConnectionCache(db);

  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: config.WEBHOOK_MAX_BODY_BYTES,
    trustProxy: true,
  });

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  const windowStartedAt = new Map<string, { count: number; resetAt: number }>();

  /** One tenant's flood must not starve another's, so the limit is per path key. */
  function withinRateLimit(pathKey: string): boolean {
    const now = Date.now();
    const entry = windowStartedAt.get(pathKey);

    if (!entry || entry.resetAt <= now) {
      windowStartedAt.set(pathKey, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    entry.count += 1;
    return entry.count <= config.WEBHOOK_RATE_LIMIT_PER_MINUTE;
  }

  app.get('/health', async () => ({ status: 'ok', service: 'ingest' }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await db.execute(sql`SELECT 1`);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    return renderMetrics();
  });

  app.post<{ Params: { webhookPathKey: string } }>('/wh/stripe/:webhookPathKey', async (request, reply) => {
    const startedAt = process.hrtime.bigint();
    const pathKey = request.params.webhookPathKey;

    const finish = (): void => {
      metrics.ackSeconds.observe(Number(process.hrtime.bigint() - startedAt) / 1e9);
    };

    const connection = await connections.byPathKey(pathKey);
    if (!connection) {
      metrics.webhookRejected.inc({ reason: 'unknown_path_key' });
      finish();
      return reply.code(404).send();
    }

    if (!withinRateLimit(pathKey)) {
      metrics.webhookRejected.inc({ reason: 'rate_limited' });
      finish();
      return reply.code(429).send();
    }

    const signature = request.headers['stripe-signature'];
    const rawBody = request.body;

    if (typeof signature !== 'string' || !Buffer.isBuffer(rawBody)) {
      metrics.webhookRejected.inc({ reason: 'malformed_request' });
      finish();
      return reply.code(400).send();
    }

    const overlapActive =
      connection.webhookSecretPrevRef !== null &&
      connection.secretOverlapUntil !== null &&
      connection.secretOverlapUntil.getTime() > Date.now();

    let event;
    try {
      const secret = await secrets.get(connection.webhookSecretRef);
      const previousSecret = overlapActive ? await secrets.get(connection.webhookSecretPrevRef!) : undefined;

      event = verifyWebhook({
        rawBody,
        signature,
        secret,
        previousSecret,
        toleranceSeconds: config.WEBHOOK_TOLERANCE_SECONDS,
      });
    } catch {
      metrics.signatureFailures.inc({ tenant_id: connection.tenantId });
      metrics.webhookRejected.inc({ reason: 'bad_signature' });
      finish();
      return reply.code(400).send();
    }

    const { objectId, objectType } = eventObjectRef(event);

    try {
      const inserted = await withTenant(db, { tenantId: connection.tenantId }, async (tx) => {
        const rows = await tx
          .insert(schema.stripeEvents)
          .values({
            tenantId: connection.tenantId,
            connectionId: connection.connectionId,
            stripeEventId: event.id,
            stripeAccountId: event.account ?? null,
            eventType: event.type,
            apiVersion: event.api_version ?? null,
            objectId,
            objectType,
            payload: event as unknown as Record<string, unknown>,
            stripeCreatedAt: new Date(event.created * 1000),
            traceId: (request.headers['x-request-id'] as string | undefined) ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: schema.stripeEvents.id });

        if (rows.length === 0) return false;

        await tx
          .insert(schema.outboxJobs)
          .values({
            tenantId: connection.tenantId,
            queue: 'stripe.event.process',
            jobKey: event.id,
            payload: {
              stripeEventId: event.id,
              connectionId: connection.connectionId,
              eventType: event.type,
              objectId,
              objectType,
              stripeAccountId: event.account ?? null,
            },
          })
          .onConflictDoNothing();

        return true;
      });

      if (inserted) {
        metrics.eventsPersisted.inc({ event_type: event.type });
      } else {
        metrics.duplicatesIgnored.inc({ event_type: event.type });
      }

      metrics.webhookReceived.inc({ event_type: event.type });
      finish();
      return reply.code(200).send({ received: true });
    } catch (error) {
      request.log.error({ err: error, tenantId: connection.tenantId }, 'Failed to persist webhook event.');
      metrics.webhookRejected.inc({ reason: 'persist_failed' });
      finish();
      /**
       * A 500 is the correct answer here. Stripe retries for up to three days, and the sweeper
       * closes anything the retries miss, so the event is delayed rather than lost.
       */
      return reply.code(500).send();
    }
  });

  return app;
}
