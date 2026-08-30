import { and, count, eq, gte, lt, sql } from 'drizzle-orm';
import type { Database } from '@magic/db';
import { schema, withTenant, withoutTenant } from '@magic/db';
import type { StripeClientFactory } from '@magic/stripe-client';
import type { Logger } from 'pino';

export interface SweeperDeps {
  readonly db: Database;
  readonly logger: Logger;
  readonly stripe: StripeClientFactory | null;
}

/**
 * Gap closure has three independent mechanisms because one is a single point of failure:
 * Stripe's own retries cover a transient endpoint failure, this cursor-based sweep covers an
 * endpoint that was down longer than the retry window, and the completeness check below covers
 * everything else by counting.
 */
export async function sweepEvents(deps: SweeperDeps, job: { tenantId: string; stripeAccountId: string }): Promise<number> {
  if (!deps.stripe) return 0;

  const [connection] = await withTenant(deps.db, { tenantId: job.tenantId }, async (tx) =>
    tx
      .select()
      .from(schema.stripeConnections)
      .where(eq(schema.stripeConnections.tenantId, job.tenantId))
      .limit(1),
  );

  if (!connection || connection.status !== 'active') return 0;

  const cursor = await withTenant(deps.db, { tenantId: job.tenantId }, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.syncCursors)
      .where(
        and(
          eq(schema.syncCursors.tenantId, job.tenantId),
          eq(schema.syncCursors.stripeAccountId, job.stripeAccountId),
          eq(schema.syncCursors.cursorType, 'events'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });

  const client = await deps.stripe.forAccount({
    apiKeyRef: connection.apiKeyRef,
    platformAccountId: connection.stripeAccountId,
    ...(job.stripeAccountId !== connection.stripeAccountId ? { connectedAccountId: job.stripeAccountId } : {}),
  });

  const page = await client.listEvents({
    limit: 100,
    ...(cursor?.lastObjectId ? { starting_after: cursor.lastObjectId } : {}),
  });

  let ingested = 0;
  let lastId = cursor?.lastObjectId ?? null;

  await withTenant(deps.db, { tenantId: job.tenantId }, async (tx) => {
    for (const event of page.data) {
      const inserted = await tx
        .insert(schema.stripeEvents)
        .values({
          tenantId: job.tenantId,
          connectionId: connection.id,
          stripeEventId: event.id,
          stripeAccountId: event.account ?? null,
          eventType: event.type,
          apiVersion: event.api_version ?? null,
          objectId: (event.data.object as { id?: string }).id ?? null,
          objectType: (event.data.object as { object?: string }).object ?? null,
          payload: event as unknown as Record<string, unknown>,
          stripeCreatedAt: new Date(event.created * 1000),
        })
        .onConflictDoNothing()
        .returning({ id: schema.stripeEvents.id });

      if (inserted.length > 0) {
        await tx
          .insert(schema.outboxJobs)
          .values({
            tenantId: job.tenantId,
            queue: 'stripe.event.process',
            jobKey: event.id,
            payload: {
              stripeEventId: event.id,
              connectionId: connection.id,
              eventType: event.type,
              objectId: (event.data.object as { id?: string }).id ?? null,
              objectType: (event.data.object as { object?: string }).object ?? null,
              stripeAccountId: event.account ?? null,
            },
          })
          .onConflictDoNothing();
        ingested += 1;
      }

      lastId = event.id;
    }

    await tx
      .insert(schema.syncCursors)
      .values({
        tenantId: job.tenantId,
        stripeAccountId: job.stripeAccountId,
        cursorType: 'events',
        lastObjectId: lastId,
        lastCreatedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.syncCursors.tenantId, schema.syncCursors.stripeAccountId, schema.syncCursors.cursorType],
        set: { lastObjectId: lastId, lastCreatedAt: new Date(), updatedAt: new Date(), lastError: null },
      });
  });

  if (ingested > 0) {
    deps.logger.warn(
      { tenantId: job.tenantId, account: job.stripeAccountId, ingested },
      'Sweeper found events the webhook endpoint never received.',
    );
  }

  return ingested;
}

/**
 * The check that turns "we believe we have everything" into "we verified we have everything".
 *
 * Any non-zero drift is a page. It is the numerical form of the product's central claim, so it
 * is computed rather than asserted, and it is stored so the trend is visible in the console.
 */
export async function runCompletenessCheck(
  deps: SweeperDeps,
  job: { tenantId: string; stripeAccountId: string; windowStart: Date; windowEnd: Date },
): Promise<{ drift: number; remote: number; local: number }> {
  const local = await withTenant(deps.db, { tenantId: job.tenantId }, async (tx) => {
    const rows = await tx
      .select({ value: count() })
      .from(schema.charges)
      .where(
        and(
          eq(schema.charges.tenantId, job.tenantId),
          eq(schema.charges.stripeAccountId, job.stripeAccountId),
          gte(schema.charges.stripeCreatedAt, job.windowStart),
          lt(schema.charges.stripeCreatedAt, job.windowEnd),
        ),
      );
    return rows[0]?.value ?? 0;
  });

  let remote = local;

  if (deps.stripe) {
    const [connection] = await withTenant(deps.db, { tenantId: job.tenantId }, async (tx) =>
      tx
        .select()
        .from(schema.stripeConnections)
        .where(eq(schema.stripeConnections.tenantId, job.tenantId))
        .limit(1),
    );

    if (connection) {
      const client = await deps.stripe.forAccount({
        apiKeyRef: connection.apiKeyRef,
        platformAccountId: connection.stripeAccountId,
        ...(job.stripeAccountId !== connection.stripeAccountId ? { connectedAccountId: job.stripeAccountId } : {}),
      });

      remote = await client.countObjects('charges', {
        gte: Math.floor(job.windowStart.getTime() / 1000),
        lt: Math.floor(job.windowEnd.getTime() / 1000),
      });
    }
  }

  await withTenant(deps.db, { tenantId: job.tenantId }, async (tx) => {
    await tx
      .insert(schema.completenessChecks)
      .values({
        tenantId: job.tenantId,
        stripeAccountId: job.stripeAccountId,
        objectType: 'charges',
        windowStart: job.windowStart,
        windowEnd: job.windowEnd,
        remoteCount: remote,
        localCount: local,
      })
      .onConflictDoUpdate({
        target: [
          schema.completenessChecks.tenantId,
          schema.completenessChecks.stripeAccountId,
          schema.completenessChecks.objectType,
          schema.completenessChecks.windowStart,
        ],
        set: { remoteCount: remote, localCount: local, checkedAt: new Date() },
      });
  });

  const drift = remote - local;
  if (drift !== 0) {
    deps.logger.error(
      { tenantId: job.tenantId, account: job.stripeAccountId, drift, remote, local },
      'Completeness drift detected. This is a page.',
    );
  }

  return { drift, remote, local };
}

/**
 * Enumerates every active tenant so the scheduler can fan out per account. Goes through
 * `active_sweep_targets` because the scheduler runs with no tenant bound and row-level security
 * would otherwise hide every account from it.
 */
export async function activeSweepTargets(db: Database): Promise<{ tenantId: string; stripeAccountId: string }[]> {
  const rows = await withoutTenant(db, async (tx) =>
    tx.execute<{ tenant_id: string; stripe_account_id: string }>(
      sql`SELECT * FROM active_sweep_targets()`,
    ),
  );
  return [...rows].map((row) => ({ tenantId: row.tenant_id, stripeAccountId: row.stripe_account_id }));
}
