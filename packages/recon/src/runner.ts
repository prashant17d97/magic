import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database, Transaction } from '@magic/db';
import { schema, withTenant } from '@magic/db';
import type { RuleSettings } from '@magic/domain';
import { ALL_RULES, checksumOf, evaluate, ruleSetChecksum, ruleSetDefinition } from '@magic/domain';
import type { Severity } from '@magic/contracts';
import { type SnapshotScope, assembleSnapshot } from './snapshot.js';

export interface RunRequest {
  readonly tenantId: string;
  readonly stripeAccountId: string;
  readonly platformAccountId: string;
  readonly payoutId?: string | null;
  readonly windowStart?: Date | null;
  readonly windowEnd?: Date | null;
  readonly mode?: 'transactional' | 'aggregate';
  readonly triggeredBy: 'webhook' | 'schedule' | 'manual';
  readonly triggeredByUser?: string | null;
  readonly asOf?: Date;
}

export interface RunOutcome {
  readonly runId: string;
  readonly status: 'completed' | 'failed';
  readonly snapshotChecksum: string;
  readonly objectsEvaluated: number;
  readonly exceptionsOpened: number;
  readonly exceptionsClosed: number;
  readonly checksumDeltaMinor: bigint | null;
  readonly error?: string;
}

/**
 * Ensures a rule version row exists for the current registry. The version is bumped only when
 * the registry checksum changes, so a deployment that touches no rule keeps producing runs that
 * are directly comparable to yesterday's.
 */
export async function ensureRuleVersion(tx: Transaction): Promise<number> {
  const checksum = ruleSetChecksum();
  const [existing] = await tx
    .select()
    .from(schema.ruleVersions)
    .where(eq(schema.ruleVersions.checksum, checksum))
    .limit(1);

  if (existing) return existing.version;

  const [latest] = await tx
    .select({ version: schema.ruleVersions.version })
    .from(schema.ruleVersions)
    .orderBy(sql`version desc`)
    .limit(1);

  const version = (latest?.version ?? 0) + 1;
  await tx.insert(schema.ruleVersions).values({
    version,
    definition: ruleSetDefinition(),
    checksum,
    notes: `Registry snapshot with ${ALL_RULES.length} rules.`,
  });
  return version;
}

async function loadSettings(tx: Transaction, tenantId: string): Promise<Map<string, RuleSettings>> {
  const rows = await tx
    .select()
    .from(schema.tenantRuleSettings)
    .where(eq(schema.tenantRuleSettings.tenantId, tenantId));

  const settings = new Map<string, RuleSettings>();
  for (const row of rows) {
    const rule = ALL_RULES.find((r) => r.id === row.ruleId);
    settings.set(row.ruleId, {
      enabled: row.enabled,
      severity: (row.severityOverride ?? rule?.severity ?? 'medium') as Severity,
      maturitySeconds: row.maturitySeconds ?? rule?.maturitySeconds ?? 0,
      parameters: (row.parameters ?? {}) as Record<string, unknown>,
    });
  }
  return settings;
}

/**
 * Executes one reconciliation run.
 *
 * The whole run commits in a single transaction. A crash halfway therefore leaves the run marked
 * failed with no partial exceptions committed, rather than a half-populated queue an operator
 * would have to distrust. The advisory lock keeps two runs off the same payout, because a
 * concurrent pair would race on the exception diff and could resurrect something just resolved.
 */
export async function executeRun(db: Database, request: RunRequest): Promise<RunOutcome> {
  const asOf = request.asOf ?? new Date();
  const mode = request.mode ?? 'transactional';
  const scopeType = request.payoutId ? 'payout' : request.stripeAccountId === request.platformAccountId ? 'platform' : 'window';

  return withTenant(db, { tenantId: request.tenantId }, async (tx) => {
    const lockKey = `${request.tenantId}:${request.stripeAccountId}:${request.payoutId ?? 'window'}`;
    const [lock] = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked`,
    );
    if (lock && lock.locked === false) {
      throw new Error(`A reconciliation run is already in flight for ${lockKey}.`);
    }

    const ruleVersion = await ensureRuleVersion(tx);

    const [run] = await tx
      .insert(schema.reconciliationRuns)
      .values({
        tenantId: request.tenantId,
        stripeAccountId: request.stripeAccountId,
        scopeType,
        payoutId: request.payoutId ?? null,
        windowStart: request.windowStart ?? null,
        windowEnd: request.windowEnd ?? null,
        ruleVersion,
        mode,
        status: 'running',
        triggeredBy: request.triggeredBy,
        triggeredByUser: request.triggeredByUser ?? null,
        startedAt: asOf,
      })
      .returning({ id: schema.reconciliationRuns.id });

    const runId = run?.id;
    if (!runId) throw new Error('Failed to create the reconciliation run row.');

    const scope: SnapshotScope = {
      tenantId: request.tenantId,
      stripeAccountId: request.stripeAccountId,
      platformAccountId: request.platformAccountId,
      payoutId: request.payoutId ?? null,
      windowStart: request.windowStart ?? null,
      windowEnd: request.windowEnd ?? null,
      mode,
      scopeType,
      asOf,
    };

    const snapshot = await assembleSnapshot(tx, scope);
    const settings = await loadSettings(tx, request.tenantId);
    const result = evaluate(snapshot, { ruleVersion, settings });

    const diff = await persistFindings(tx, {
      tenantId: request.tenantId,
      runId,
      scopeKey: snapshot.scopeKey,
      stripeAccountId: request.stripeAccountId,
      findings: result.findings,
      asOf,
    });

    const reconstructed = snapshot.payout
      ? snapshot.balanceTransactions
          .filter((b) => b.payoutId === snapshot.payout?.id)
          .reduce((acc, b) => acc + b.netMinor, 0n)
      : null;
    const checksumDelta =
      snapshot.payout && reconstructed !== null ? reconstructed - snapshot.payout.amountMinor : null;

    await tx
      .update(schema.reconciliationRuns)
      .set({
        status: 'completed',
        snapshotChecksum: snapshot.checksum,
        objectsEvaluated: result.objectsEvaluated,
        exceptionsOpened: diff.opened,
        exceptionsClosed: diff.closed,
        checksumDeltaMinor: checksumDelta,
        payoutAmountMinor: snapshot.payout?.amountMinor ?? null,
        reconstructedMinor: reconstructed,
        currency: snapshot.payout?.currency ?? null,
        finishedAt: new Date(),
      })
      .where(eq(schema.reconciliationRuns.id, runId));

    return {
      runId,
      status: 'completed' as const,
      snapshotChecksum: snapshot.checksum,
      objectsEvaluated: result.objectsEvaluated,
      exceptionsOpened: diff.opened,
      exceptionsClosed: diff.closed,
      checksumDeltaMinor: checksumDelta,
    };
  });
}

interface PersistArgs {
  readonly tenantId: string;
  readonly runId: string;
  readonly scopeKey: string;
  readonly stripeAccountId: string;
  readonly findings: readonly ReturnType<typeof evaluate>['findings'][number][];
  readonly asOf: Date;
}

/**
 * Re-running is safe because identity is `(rule_id, subject_id, scope_key)`. A finding that is
 * still true updates `last_seen_*` on the existing row; a finding an operator already resolved
 * stays resolved unless the underlying facts changed, which shows up as a different
 * expected/actual payload. Anything no longer produced is closed by the system with a note.
 */
async function persistFindings(tx: Transaction, args: PersistArgs): Promise<{ opened: number; closed: number }> {
  const fingerprints = args.findings.map((f) => f.fingerprint);

  const existing = await tx
    .select()
    .from(schema.exceptions)
    .where(
      and(
        eq(schema.exceptions.tenantId, args.tenantId),
        eq(schema.exceptions.scopeKey, args.scopeKey),
      ),
    );

  const existingByFingerprint = new Map(existing.map((e) => [e.fingerprint, e]));
  let opened = 0;

  for (const finding of args.findings) {
    const prior = existingByFingerprint.get(finding.fingerprint);
    const ruleTrace = {
      rule_id: finding.ruleId,
      rule_version: finding.ruleVersion,
      layer: finding.layer,
      maturity_seconds: finding.maturitySeconds,
      evaluated_at: args.asOf.toISOString(),
      parameters: finding.parameters,
      mode: finding.mode,
    };

    const payload = {
      severity: finding.severity,
      exposureMinor: finding.exposureMinor,
      currency: finding.currency,
      expected: serialise(finding.expected),
      actual: serialise(finding.actual),
      evidence: serialise(finding.evidence),
      ruleTrace,
      narrative: finding.narrative,
      lastSeenRunId: args.runId,
      lastSeenAt: args.asOf,
    };

    if (!prior) {
      await tx.insert(schema.exceptions).values({
        tenantId: args.tenantId,
        stripeAccountId: args.stripeAccountId,
        ruleId: finding.ruleId,
        ruleVersion: finding.ruleVersion,
        layer: finding.layer,
        subjectType: finding.subjectType,
        subjectId: finding.subjectId,
        scopeKey: finding.scopeKey,
        fingerprint: finding.fingerprint,
        status: 'open',
        firstSeenRunId: args.runId,
        firstSeenAt: args.asOf,
        ...payload,
      });
      await tx.insert(schema.exceptionEvents).values({
        tenantId: args.tenantId,
        exceptionId: (
          await tx
            .select({ id: schema.exceptions.id })
            .from(schema.exceptions)
            .where(and(eq(schema.exceptions.tenantId, args.tenantId), eq(schema.exceptions.fingerprint, finding.fingerprint)))
            .limit(1)
        )[0]!.id,
        fromStatus: null,
        toStatus: 'open',
        actorType: 'system',
        note: `Raised by ${finding.ruleId} in run ${args.runId}.`,
      });
      opened += 1;
      continue;
    }

    /**
     * Compared canonically rather than by JSON text. Postgres reorders jsonb keys on storage, so
     * a plain string comparison would report every unchanged finding as changed and reopen
     * exceptions an operator had already closed.
     */
    const factsChanged =
      checksumOf(prior.expected) !== checksumOf(payload.expected) ||
      checksumOf(prior.actual) !== checksumOf(payload.actual);

    const reopen = factsChanged && (prior.status === 'resolved' || prior.status === 'ignored');

    await tx
      .update(schema.exceptions)
      .set({
        ...payload,
        ...(reopen ? { status: 'open', resolvedAt: null, resolvedBy: null, resolutionNote: null } : {}),
      })
      .where(eq(schema.exceptions.id, prior.id));

    if (reopen) {
      await tx.insert(schema.exceptionEvents).values({
        tenantId: args.tenantId,
        exceptionId: prior.id,
        fromStatus: prior.status,
        toStatus: 'open',
        actorType: 'system',
        note: 'Reopened: the underlying figures changed since this was closed.',
      });
      opened += 1;
    }
  }

  const stale = existing.filter(
    (e) => !fingerprints.includes(e.fingerprint) && (e.status === 'open' || e.status === 'investigating'),
  );

  if (stale.length > 0) {
    await tx
      .update(schema.exceptions)
      .set({
        status: 'resolved',
        resolvedAt: args.asOf,
        resolutionNote: 'Closed automatically: the condition no longer holds in the current data.',
      })
      .where(
        and(
          eq(schema.exceptions.tenantId, args.tenantId),
          inArray(
            schema.exceptions.id,
            stale.map((e) => e.id),
          ),
        ),
      );

    for (const item of stale) {
      await tx.insert(schema.exceptionEvents).values({
        tenantId: args.tenantId,
        exceptionId: item.id,
        fromStatus: item.status,
        toStatus: 'resolved',
        actorType: 'system',
        note: 'Closed automatically: the condition no longer holds in the current data.',
      });
    }
  }

  return { opened, closed: stale.length };
}

/** JSONB cannot hold BigInt, so amounts are stored as strings and stay lossless. */
function serialise(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Record<string, unknown>;
}
