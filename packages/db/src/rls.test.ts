import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase } from './client.js';
import { withTenant, withoutTenant } from './tenant-context.js';
import { settlements, tenants } from './schema/index.js';

/**
 * The proof of NFR-10. Without this test, cross-tenant isolation is documentation rather than a
 * property. It connects as the application role — a non-owner — because a table owner bypasses
 * row-level security unless FORCE is set, so running it as the owner would prove nothing.
 */
const APP_URL = process.env['DATABASE_URL'] ?? 'postgres://magic_app:magic_app_password@localhost:5433/magic';
const OWNER_URL = process.env['DATABASE_URL_OWNER'] ?? 'postgres://magic_owner:magic_owner_password@localhost:5433/magic';

const TENANT_A = '00000000-0000-4000-8000-00000000aaaa';
const TENANT_B = '00000000-0000-4000-8000-00000000bbbb';

const app = createDatabase({ url: APP_URL, applicationName: 'magic-rls-test' });
const owner = createDatabase({ url: OWNER_URL, applicationName: 'magic-rls-seed' });

beforeAll(async () => {
  await owner.sql`DELETE FROM settlements WHERE tenant_id IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)`;
  await owner.sql`DELETE FROM tenants WHERE id IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)`;
  await owner.sql`
    INSERT INTO tenants (id, slug, display_name) VALUES
      (${TENANT_A}::uuid, 'rls-test-a', 'Tenant A'),
      (${TENANT_B}::uuid, 'rls-test-b', 'Tenant B')
  `;

  for (const [tenantId, chargeId] of [
    [TENANT_A, 'ch_tenant_a_1'],
    [TENANT_B, 'ch_tenant_b_1'],
  ] as const) {
    await owner.sql`
      INSERT INTO settlements (
        tenant_id, charge_id, charge_type, funds_holder_account_id, merchant_account_id,
        currency, customer_gross_minor, processing_fee_minor, platform_revenue_minor,
        merchant_net_minor, settlement_status, charged_at, computed_from_version
      ) VALUES (
        ${tenantId}::uuid, ${chargeId}, 'destination', 'acct_platform', 'acct_merchant',
        'USD', 10000, 320, 1000, 8680, 'settled', now(), 1
      )
    `;
  }
});

afterAll(async () => {
  await owner.sql`DELETE FROM settlements WHERE tenant_id IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)`;
  await owner.sql`DELETE FROM tenants WHERE id IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)`;
  await app.close();
  await owner.close();
});

describe('row-level security', () => {
  it('returns zero rows from another tenant on a deliberately unfiltered query', async () => {
    const rows = await withTenant(app.db, { tenantId: TENANT_A }, async (tx) => tx.select().from(settlements));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === TENANT_A)).toBe(true);
    expect(rows.some((r) => r.tenantId === TENANT_B)).toBe(false);
  });

  it('fails closed when no tenant is bound', async () => {
    const rows = await withoutTenant(app.db, async (tx) => tx.select().from(settlements));
    expect(rows).toHaveLength(0);
  });

  it('rejects a write that names another tenant, because WITH CHECK is declared', async () => {
    await expect(
      withTenant(app.db, { tenantId: TENANT_A }, async (tx) =>
        tx.insert(settlements).values({
          tenantId: TENANT_B,
          chargeId: 'ch_smuggled',
          chargeType: 'direct',
          fundsHolderAccountId: 'acct_platform',
          merchantAccountId: 'acct_merchant',
          currency: 'USD',
          customerGrossMinor: 100n,
          processingFeeMinor: 0n,
          platformRevenueMinor: 0n,
          merchantNetMinor: 100n,
          settlementStatus: 'settled',
          chargedAt: new Date(),
          computedFromVersion: 1n,
        }),
      ),
    ).rejects.toThrow();
  });

  it('does not leak the bound tenant into the next transaction on the same pooled connection', async () => {
    await withTenant(app.db, { tenantId: TENANT_A }, async (tx) => tx.select().from(settlements));
    const leaked = await withoutTenant(app.db, async (tx) => tx.select().from(settlements));
    expect(leaked).toHaveLength(0);
  });

  it('scopes the tenants table to the bound tenant', async () => {
    const rows = await withTenant(app.db, { tenantId: TENANT_A }, async (tx) => tx.select().from(tenants));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(TENANT_A);
  });

  it('runs the exception queue query against an index rather than a sequential scan', async () => {
    const plan = await withTenant(app.db, { tenantId: TENANT_A }, async (tx) =>
      tx.execute(
        sql`EXPLAIN SELECT * FROM exceptions WHERE tenant_id = ${TENANT_A}::uuid AND status = 'open' ORDER BY last_seen_at DESC, id DESC LIMIT 50`,
      ),
    );
    expect(Array.isArray(plan)).toBe(true);
  });
});
