import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDatabase, schema, withTenant } from '@magic/db';
import { SCENARIOS } from './scenarios/all.js';
import { reconcileScenario, seedScenario, seedTenant } from './seeder.js';

/**
 * The proof of NFR-6. Every scenario runs twice against the same rule version and the exception
 * payloads must be byte-identical. A rule that reads the clock, generates an identifier, or
 * iterates an unordered collection fails here rather than in production six weeks later.
 */
const OWNER_URL = process.env['DATABASE_URL_OWNER'] ?? 'postgres://magic_owner:magic_owner_password@localhost:5433/magic';
const { db, close } = createDatabase({ url: OWNER_URL, applicationName: 'magic-determinism' });

afterAll(async () => {
  await close();
});

async function exceptionDigest(tenantId: string): Promise<string> {
  return withTenant(db, { tenantId }, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.exceptions)
      .where(eq(schema.exceptions.tenantId, tenantId));

    const comparable = rows
      .map((row) => ({
        fingerprint: row.fingerprint,
        rule_id: row.ruleId,
        rule_version: row.ruleVersion,
        layer: row.layer,
        severity: row.severity,
        subject_type: row.subjectType,
        subject_id: row.subjectId,
        scope_key: row.scopeKey,
        exposure_minor: row.exposureMinor?.toString() ?? null,
        currency: row.currency,
        expected: row.expected,
        actual: row.actual,
        evidence: row.evidence,
        narrative: row.narrative,
      }))
      .sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1));

    return JSON.stringify(comparable);
  });
}

describe('reconciliation determinism', () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))(
    'scenario %s produces a byte-identical exception set on a second run',
    async (id, scenario) => {
      const tenant = await seedTenant(db, {
        slug: `det-${id}-${Date.now().toString(36)}`,
        displayName: `Determinism ${scenario.title}`,
      });

      await seedScenario(db, {
        tenantId: tenant.tenantId,
        orderConnectionId: tenant.orderConnectionId,
        scenario,
      });

      const first = await reconcileScenario(db, { tenantId: tenant.tenantId, scenario });
      const firstDigest = await exceptionDigest(tenant.tenantId);

      const second = await reconcileScenario(db, { tenantId: tenant.tenantId, scenario });
      const secondDigest = await exceptionDigest(tenant.tenantId);

      expect(second.ruleIds).toEqual(first.ruleIds);
      expect(secondDigest).toBe(firstDigest);
    },
    60_000,
  );

  it('records the same snapshot checksum for two runs over unchanged data', async () => {
    const scenario = SCENARIOS[0];
    if (!scenario) throw new Error('The corpus is empty.');

    const tenant = await seedTenant(db, {
      slug: `chk-${Date.now().toString(36)}`,
      displayName: 'Checksum stability',
    });

    await seedScenario(db, {
      tenantId: tenant.tenantId,
      orderConnectionId: tenant.orderConnectionId,
      scenario,
    });

    const first = await reconcileScenario(db, { tenantId: tenant.tenantId, scenario });
    const second = await reconcileScenario(db, { tenantId: tenant.tenantId, scenario });

    const checksums = await withTenant(db, { tenantId: tenant.tenantId }, async (tx) => {
      const rows = await tx
        .select({ id: schema.reconciliationRuns.id, checksum: schema.reconciliationRuns.snapshotChecksum })
        .from(schema.reconciliationRuns)
        .where(eq(schema.reconciliationRuns.tenantId, tenant.tenantId));
      return new Map(rows.map((r) => [r.id, r.checksum]));
    });

    expect(checksums.get(first.runId)).toBe(checksums.get(second.runId));
    expect(checksums.get(first.runId)).toHaveLength(64);
  }, 60_000);

  it('does not resurrect an exception an operator already resolved', async () => {
    const scenario = SCENARIOS[0];
    if (!scenario) throw new Error('The corpus is empty.');

    const tenant = await seedTenant(db, {
      slug: `res-${Date.now().toString(36)}`,
      displayName: 'Resolution stability',
    });

    await seedScenario(db, {
      tenantId: tenant.tenantId,
      orderConnectionId: tenant.orderConnectionId,
      scenario,
    });
    await reconcileScenario(db, { tenantId: tenant.tenantId, scenario });

    await withTenant(db, { tenantId: tenant.tenantId }, async (tx) => {
      await tx
        .update(schema.exceptions)
        .set({ status: 'resolved', resolvedAt: new Date(), resolutionNote: 'Verified against the bank.' })
        .where(eq(schema.exceptions.tenantId, tenant.tenantId));
    });

    await reconcileScenario(db, { tenantId: tenant.tenantId, scenario });

    const statuses = await withTenant(db, { tenantId: tenant.tenantId }, async (tx) =>
      tx
        .select({ status: schema.exceptions.status })
        .from(schema.exceptions)
        .where(and(eq(schema.exceptions.tenantId, tenant.tenantId))),
    );

    expect(statuses.every((s) => s.status === 'resolved')).toBe(true);
  }, 60_000);
});
