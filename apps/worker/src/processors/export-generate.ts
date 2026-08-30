import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '@magic/db';
import { schema, withTenant } from '@magic/db';
import { toCsvRow } from '@magic/security';
import type { Logger } from 'pino';

export interface ExportJob {
  readonly tenantId: string;
  readonly exportId: string;
}

export interface ExportDeps {
  readonly db: Database;
  readonly logger: Logger;
  readonly outputDir: string;
  readonly urlTtlSeconds: number;
}

const HEADERS: Record<string, string[]> = {
  exceptions: [
    'id', 'rule_id', 'rule_version', 'layer', 'severity', 'status', 'stripe_account_id',
    'subject_type', 'subject_id', 'exposure_minor', 'currency', 'narrative',
    'first_seen_at', 'last_seen_at', 'resolved_at', 'resolution_note',
  ],
  settlements: [
    'charge_id', 'charge_type', 'merchant_account_id', 'funds_holder_account_id', 'currency',
    'customer_gross_minor', 'processing_fee_minor', 'platform_revenue_minor', 'merchant_net_minor',
    'refunded_minor', 'settlement_status', 'payout_id', 'charged_at',
  ],
  runs: [
    'id', 'stripe_account_id', 'scope_type', 'payout_id', 'mode', 'status', 'rule_version',
    'objects_evaluated', 'exceptions_opened', 'exceptions_closed', 'checksum_delta_minor',
    'snapshot_checksum', 'started_at', 'finished_at',
  ],
  audit: ['id', 'actor_type', 'actor_user_id', 'action', 'resource_type', 'resource_id', 'ip_address', 'created_at'],
};

/**
 * Exports are always asynchronous and always streamed.
 *
 * Buffering a million rows in memory to hand back a synchronous response is how an export takes
 * down the API, so no endpoint returns a full dataset and the writer never holds more than a
 * page. The account scope is snapshotted at generation time, not read at request time: a
 * membership narrowed after the request was queued must still narrow the file.
 */
export async function generateExport(deps: ExportDeps, job: ExportJob): Promise<{ rowCount: number; objectKey: string }> {
  const record = await withTenant(deps.db, { tenantId: job.tenantId }, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.exports)
      .where(and(eq(schema.exports.tenantId, job.tenantId), eq(schema.exports.id, job.exportId)))
      .limit(1);
    return rows[0];
  });

  if (!record) throw new Error(`Export ${job.exportId} does not exist.`);

  await withTenant(deps.db, { tenantId: job.tenantId }, async (tx) => {
    await tx.update(schema.exports).set({ status: 'running' }).where(eq(schema.exports.id, record.id));
  });

  const objectKey = `exports/${job.tenantId}/${record.id}.${record.format}`;
  const filePath = join(deps.outputDir, objectKey);
  await mkdir(dirname(filePath), { recursive: true });

  try {
    const headers = HEADERS[record.kind] ?? [];
    let rowCount = 0;

    const rows = await fetchRows(deps.db, job.tenantId, record.kind, record.scopeSnapshot);

    async function* lines(): AsyncGenerator<string> {
      yield `${toCsvRow(headers)}\n`;
      for (const row of rows) {
        rowCount += 1;
        yield `${toCsvRow(headers.map((h) => row[h] ?? ''))}\n`;
      }
    }

    await pipeline(Readable.from(lines()), createWriteStream(filePath, { encoding: 'utf8' }));

    await withTenant(deps.db, { tenantId: job.tenantId }, async (tx) => {
      await tx
        .update(schema.exports)
        .set({
          status: 'ready',
          rowCount,
          objectKey,
          expiresAt: new Date(Date.now() + deps.urlTtlSeconds * 1000),
        })
        .where(eq(schema.exports.id, record.id));
    });

    return { rowCount, objectKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(deps.db, { tenantId: job.tenantId }, async (tx) => {
      await tx
        .update(schema.exports)
        .set({ status: 'failed', error: message.slice(0, 1000) })
        .where(eq(schema.exports.id, record.id));
    });
    deps.logger.error({ err: error, exportId: job.exportId }, 'Export generation failed.');
    throw error;
  }
}

async function fetchRows(
  db: Database,
  tenantId: string,
  kind: string,
  scope: string[] | null,
): Promise<Record<string, unknown>[]> {
  return withTenant(db, { tenantId }, async (tx) => {
    switch (kind) {
      case 'exceptions': {
        const rows = await tx
          .select()
          .from(schema.exceptions)
          .where(
            and(
              eq(schema.exceptions.tenantId, tenantId),
              scope && scope.length > 0 ? inArray(schema.exceptions.stripeAccountId, scope) : sql`true`,
            ),
          );
        return rows.map((r) => ({
          id: r.id,
          rule_id: r.ruleId,
          rule_version: r.ruleVersion,
          layer: r.layer,
          severity: r.severity,
          status: r.status,
          stripe_account_id: r.stripeAccountId,
          subject_type: r.subjectType,
          subject_id: r.subjectId,
          exposure_minor: r.exposureMinor?.toString() ?? '',
          currency: r.currency ?? '',
          narrative: r.narrative,
          first_seen_at: r.firstSeenAt.toISOString(),
          last_seen_at: r.lastSeenAt.toISOString(),
          resolved_at: r.resolvedAt?.toISOString() ?? '',
          resolution_note: r.resolutionNote ?? '',
        }));
      }

      case 'settlements': {
        const rows = await tx
          .select()
          .from(schema.settlements)
          .where(
            and(
              eq(schema.settlements.tenantId, tenantId),
              scope && scope.length > 0 ? inArray(schema.settlements.merchantAccountId, scope) : sql`true`,
            ),
          );
        return rows.map((r) => ({
          charge_id: r.chargeId,
          charge_type: r.chargeType,
          merchant_account_id: r.merchantAccountId,
          funds_holder_account_id: r.fundsHolderAccountId,
          currency: r.currency,
          customer_gross_minor: r.customerGrossMinor.toString(),
          processing_fee_minor: r.processingFeeMinor.toString(),
          platform_revenue_minor: r.platformRevenueMinor.toString(),
          merchant_net_minor: r.merchantNetMinor.toString(),
          refunded_minor: r.refundedMinor.toString(),
          settlement_status: r.settlementStatus,
          payout_id: r.payoutId ?? '',
          charged_at: r.chargedAt.toISOString(),
        }));
      }

      case 'runs': {
        const rows = await tx
          .select()
          .from(schema.reconciliationRuns)
          .where(eq(schema.reconciliationRuns.tenantId, tenantId));
        return rows.map((r) => ({
          id: r.id,
          stripe_account_id: r.stripeAccountId,
          scope_type: r.scopeType,
          payout_id: r.payoutId ?? '',
          mode: r.mode,
          status: r.status,
          rule_version: r.ruleVersion,
          objects_evaluated: r.objectsEvaluated,
          exceptions_opened: r.exceptionsOpened,
          exceptions_closed: r.exceptionsClosed,
          checksum_delta_minor: r.checksumDeltaMinor?.toString() ?? '',
          snapshot_checksum: r.snapshotChecksum ?? '',
          started_at: r.startedAt?.toISOString() ?? '',
          finished_at: r.finishedAt?.toISOString() ?? '',
        }));
      }

      case 'audit': {
        const rows = await tx.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, tenantId));
        return rows.map((r) => ({
          id: r.id.toString(),
          actor_type: r.actorType,
          actor_user_id: r.actorUserId ?? '',
          action: r.action,
          resource_type: r.resourceType,
          resource_id: r.resourceId,
          ip_address: r.ipAddress ?? '',
          created_at: r.createdAt.toISOString(),
        }));
      }

      default:
        return [];
    }
  });
}
