import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@magic/db';
import { SCENARIOS } from './scenarios/all.js';
import { reconcileScenario, seedScenario, seedTenant } from './seeder.js';

/**
 * Each scenario is seeded into its own tenant so one fixture's data can never influence
 * another's expectation. The corpus is the specification: a rule change that stops catching a
 * named failure breaks the fixture that named it, rather than passing quietly.
 */
const OWNER_URL = process.env['DATABASE_URL_OWNER'] ?? 'postgres://magic_owner:magic_owner_password@localhost:5433/magic';
const { db, close } = createDatabase({ url: OWNER_URL, applicationName: 'magic-fixtures' });

afterAll(async () => {
  await close();
});

describe('fixture corpus', () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))(
    'scenario %s raises exactly its declared exceptions',
    async (id, scenario) => {
      const tenant = await seedTenant(db, {
        slug: `fx-${id}-${Date.now().toString(36)}`,
        displayName: `Fixture ${scenario.title}`,
      });

      await seedScenario(db, {
        tenantId: tenant.tenantId,
        orderConnectionId: tenant.orderConnectionId,
        scenario,
      });

      const result = await reconcileScenario(db, { tenantId: tenant.tenantId, scenario });
      expect(result.ruleIds).toEqual([...scenario.expectedRuleIds].sort());
    },
    60_000,
  );
});
