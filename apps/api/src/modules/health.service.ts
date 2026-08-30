import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Database } from '@magic/db';
import { schema, withTenant } from '@magic/db';
import type { HealthSummary } from '@magic/contracts';
import { DATABASE } from '../platform/database.module.js';
import type { Principal } from '../auth/principal.js';

/**
 * The health view leads with completeness rather than revenue.
 *
 * A revenue figure at the top would imply this is a reporting tool. The first thing an operator
 * needs to know is whether the data can be trusted at all, and every tile below that is only
 * meaningful once it can.
 */
@Injectable()
export class HealthService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async summary(principal: Principal): Promise<HealthSummary> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const tenantId = principal.tenantId;
      const scope = principal.accountScope;
      const since = new Date(Date.now() - 30 * 86_400_000);

      const accountFilter = scope?.length
        ? inArray(schema.completenessChecks.stripeAccountId, scope)
        : undefined;

      const completenessRows = await tx
        .select()
        .from(schema.completenessChecks)
        .where(
          and(
            eq(schema.completenessChecks.tenantId, tenantId),
            gte(schema.completenessChecks.checkedAt, new Date(Date.now() - 2 * 86_400_000)),
            ...(accountFilter ? [accountFilter] : []),
          ),
        );

      const totalDrift = completenessRows.reduce((acc, r) => acc + Math.abs(r.drift ?? 0), 0);
      const accountsWithDrift = new Set(
        completenessRows.filter((r) => (r.drift ?? 0) !== 0).map((r) => r.stripeAccountId),
      ).size;
      const accountsChecked = new Set(completenessRows.map((r) => r.stripeAccountId)).size;
      const remoteTotal = completenessRows.reduce((acc, r) => acc + r.remoteCount, 0);

      const [lagRow] = await tx.execute<{ lag: string | null; recent: string; pending: string; failed: string }>(sql`
        SELECT
          coalesce(percentile_disc(0.95) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (processed_at - received_at))
          ) FILTER (WHERE processed_at IS NOT NULL), 0)::text AS lag,
          count(*) FILTER (WHERE received_at > now() - interval '1 hour')::text AS recent,
          count(*) FILTER (WHERE process_status = 'pending')::text AS pending,
          count(*) FILTER (WHERE process_status IN ('failed','dead'))::text AS failed
        FROM stripe_events
        WHERE tenant_id = ${tenantId}::uuid
      `);

      const [outboxRow] = await tx.execute<{ depth: string }>(sql`
        SELECT count(*)::text AS depth FROM outbox_jobs
        WHERE tenant_id = ${tenantId}::uuid AND published_at IS NULL
      `);

      const [dlqRow] = await tx.execute<{ depth: string }>(sql`
        SELECT count(*)::text AS depth FROM dead_letter_jobs
        WHERE tenant_id = ${tenantId}::uuid AND replayed_at IS NULL
      `);

      const exposure = await tx
        .select({
          severity: schema.exceptions.severity,
          currency: schema.exceptions.currency,
          total: sql<string>`coalesce(sum(${schema.exceptions.exposureMinor}), 0)::text`,
          value: sql<number>`count(*)::int`,
        })
        .from(schema.exceptions)
        .where(
          and(
            eq(schema.exceptions.tenantId, tenantId),
            inArray(schema.exceptions.status, ['open', 'investigating']),
            ...(scope?.length ? [inArray(schema.exceptions.stripeAccountId, scope)] : []),
          ),
        )
        .groupBy(schema.exceptions.severity, schema.exceptions.currency);

      /**
       * Opened and resolved are counted independently. Joining `exceptions` twice against the
       * day series multiplied them together instead: a day with 24 opened and 26 resolved
       * produced 624 rows and reported 624 for both counts.
       */
      const trend = await tx.execute<{ day: string; opened: string; resolved: string }>(sql`
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
               (SELECT count(*) FROM exceptions o
                 WHERE o.tenant_id = ${tenantId}::uuid
                   AND o.first_seen_at::date = d.day)::text AS opened,
               (SELECT count(*) FROM exceptions r
                 WHERE r.tenant_id = ${tenantId}::uuid
                   AND r.resolved_at::date = d.day)::text AS resolved
          FROM generate_series(${since.toISOString()}::date, now()::date, interval '1 day') AS d(day)
         ORDER BY d.day
      `);

      const attention = await tx
        .select({
          account: schema.connectedAccounts,
          openCount: sql<number>`(
            SELECT count(*)::int FROM exceptions e
             WHERE e.tenant_id = ${tenantId}::uuid
               AND e.stripe_account_id = ${schema.connectedAccounts.stripeAccountId}
               AND e.status IN ('open','investigating')
          )`,
          exposure: sql<string>`(
            SELECT coalesce(sum(e.exposure_minor), 0)::text FROM exceptions e
             WHERE e.tenant_id = ${tenantId}::uuid
               AND e.stripe_account_id = ${schema.connectedAccounts.stripeAccountId}
               AND e.status IN ('open','investigating')
          )`,
        })
        .from(schema.connectedAccounts)
        .where(
          and(
            eq(schema.connectedAccounts.tenantId, tenantId),
            ...(scope?.length ? [inArray(schema.connectedAccounts.stripeAccountId, scope)] : []),
          ),
        );

      const recentRuns = await tx
        .select({ run: schema.reconciliationRuns, accountName: schema.connectedAccounts.displayName })
        .from(schema.reconciliationRuns)
        .leftJoin(
          schema.connectedAccounts,
          and(
            eq(schema.connectedAccounts.tenantId, schema.reconciliationRuns.tenantId),
            eq(schema.connectedAccounts.stripeAccountId, schema.reconciliationRuns.stripeAccountId),
          ),
        )
        .where(eq(schema.reconciliationRuns.tenantId, tenantId))
        .orderBy(desc(schema.reconciliationRuns.createdAt))
        .limit(8);

      const lastRun = recentRuns[0]?.run ?? null;
      const driftByAccount = new Map(
        completenessRows.map((r) => [r.stripeAccountId, r.drift ?? 0] as const),
      );

      return {
        completeness: {
          percent: remoteTotal === 0 ? 100 : Number((((remoteTotal - totalDrift) / remoteTotal) * 100).toFixed(2)),
          accounts_checked: accountsChecked,
          total_drift: totalDrift,
          accounts_with_drift: accountsWithDrift,
          last_checked_at:
            completenessRows.length > 0
              ? completenessRows
                  .map((r) => r.checkedAt)
                  .sort((a, b) => b.getTime() - a.getTime())[0]!
                  .toISOString()
              : null,
        },
        ingestion: {
          lag_p95_seconds: Number(lagRow?.lag ?? 0),
          events_last_hour: Number(lagRow?.recent ?? 0),
          pending_events: Number(lagRow?.pending ?? 0),
          failed_events: Number(lagRow?.failed ?? 0),
        },
        queues: {
          total_depth: Number(outboxRow?.depth ?? 0),
          dlq_depth: Number(dlqRow?.depth ?? 0),
          by_queue: [
            { queue: 'outbox', depth: Number(outboxRow?.depth ?? 0), active: 0 },
            { queue: 'dead.letter', depth: Number(dlqRow?.depth ?? 0), active: 0 },
          ],
        },
        last_run: lastRun
          ? {
              id: lastRun.id,
              finished_at: lastRun.finishedAt?.toISOString() ?? null,
              objects_evaluated: lastRun.objectsEvaluated,
              status: lastRun.status as HealthSummary['last_run'] extends null ? never : 'completed',
              checksum_delta_minor: lastRun.checksumDeltaMinor?.toString() ?? null,
            }
          : null,
        exposure: exposure
          .filter((r) => r.currency !== null)
          .map((r) => ({
            severity: r.severity as HealthSummary['exposure'][number]['severity'],
            currency: r.currency as string,
            total_minor: r.total,
            count: r.value,
          })),
        trend: [...trend].map((r) => ({
          date: r.day,
          opened: Number(r.opened),
          resolved: Number(r.resolved),
        })),
        accounts_needing_attention: attention
          .map((row) => {
            const drift = driftByAccount.get(row.account.stripeAccountId) ?? 0;
            const reason = !row.account.chargesEnabled
              ? ('charges_disabled' as const)
              : !row.account.payoutsEnabled
                ? ('payouts_paused' as const)
                : drift !== 0
                  ? ('completeness_drift' as const)
                  : null;

            if (!reason) return null;

            return {
              stripe_account_id: row.account.stripeAccountId,
              display_name: row.account.displayName,
              reason,
              detail:
                reason === 'charges_disabled'
                  ? (row.account.requirementsDisabledReason ?? 'Charges are disabled on this account.')
                  : reason === 'payouts_paused'
                    ? 'Payouts are paused, so payout checks are suppressed for this account.'
                    : `${Math.abs(drift)} object(s) present at Stripe are missing locally.`,
              open_exceptions: row.openCount,
              exposure_minor: row.exposure,
              currency: row.account.defaultCurrency,
            };
          })
          .filter((row): row is NonNullable<typeof row> => row !== null)
          .sort((a, b) => Number(b.exposure_minor ?? 0) - Number(a.exposure_minor ?? 0)),
        recent_runs: recentRuns.map((r) => ({
          id: r.run.id,
          stripe_account_id: r.run.stripeAccountId,
          account_display_name: r.accountName,
          payout_id: r.run.payoutId,
          status: r.run.status as HealthSummary['recent_runs'][number]['status'],
          checksum_delta_minor: r.run.checksumDeltaMinor?.toString() ?? null,
          currency: r.run.currency,
          exceptions_opened: r.run.exceptionsOpened,
          finished_at: r.run.finishedAt?.toISOString() ?? null,
        })),
      };
    });
  }
}
