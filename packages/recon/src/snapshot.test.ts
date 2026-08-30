import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, schema, withTenant, withoutTenant } from '@magic/db';
import { assembleSnapshot } from './snapshot.js';
import { recomputeSettlement } from './projector.js';

/**
 * Snapshot assembly is where determinism is won or lost.
 *
 * The rule engine is pure, so if two runs over identical rows can produce different snapshots —
 * because a query came back in a different order, or because a scope pulled in a neighbouring
 * object — then determinism fails for a reason that has nothing to do with any rule.
 */
const OWNER_URL = process.env['DATABASE_URL_OWNER'] ?? 'postgres://magic_owner:magic_owner_password@localhost:5433/magic';
const { db, close } = createDatabase({ url: OWNER_URL, applicationName: 'magic-recon-test' });

const PLATFORM = 'acct_recon_platform';
const MERCHANT = 'acct_recon_merchant';
const AS_OF = new Date('2026-08-29T12:00:00.000Z');

let tenantId: string;

beforeAll(async () => {
  tenantId = await withoutTenant(db, async (tx) => {
    const [tenant] = await tx
      .insert(schema.tenants)
      .values({ slug: `recon-${Date.now().toString(36)}`, displayName: 'Recon suite' })
      .returning({ id: schema.tenants.id });

    const [connection] = await tx
      .insert(schema.stripeConnections)
      .values({
        tenantId: tenant!.id,
        stripeAccountId: PLATFORM,
        livemode: false,
        webhookPathKey: `whk_recon_${Date.now().toString(36)}`,
        webhookSecretRef: 'STRIPE_WEBHOOK_SECRET',
        apiKeyRef: 'STRIPE_PLATFORM_API_KEY',
      })
      .returning({ id: schema.stripeConnections.id });

    for (const accountId of [PLATFORM, MERCHANT]) {
      await tx.insert(schema.connectedAccounts).values({
        tenantId: tenant!.id,
        connectionId: connection!.id,
        stripeAccountId: accountId,
        displayName: accountId,
        defaultCurrency: 'USD',
        chargesEnabled: true,
        payoutsEnabled: true,
      });
    }

    return tenant!.id;
  });

  await withTenant(db, { tenantId }, async (tx) => {
    /** Two charges in the same payout, inserted out of identifier order on purpose. */
    for (const [chargeId, txnId, amount] of [
      ['ch_recon_b', 'txn_recon_b', 40_000n],
      ['ch_recon_a', 'txn_recon_a', 60_000n],
    ] as const) {
      await tx.insert(schema.charges).values({
        tenantId,
        stripeAccountId: PLATFORM,
        stripeChargeId: chargeId,
        balanceTransactionId: txnId,
        amountMinor: amount,
        currency: 'USD',
        amountCapturedMinor: amount,
        status: 'succeeded',
        paid: true,
        captured: true,
        transferDestination: MERCHANT,
        transferDataAmountMinor: amount - amount / 10n,
        stripeCreatedAt: new Date('2026-08-25T10:00:00.000Z'),
        sourceVersion: 1n,
      });

      await tx.insert(schema.balanceTransactions).values({
        tenantId,
        stripeAccountId: PLATFORM,
        stripeBtxnId: txnId,
        type: 'charge',
        sourceId: chargeId,
        grossMinor: amount,
        feeMinor: 1_000n,
        netMinor: amount - 1_000n,
        currency: 'USD',
        payoutId: 'po_recon_1',
        stripeCreatedAt: new Date('2026-08-25T10:00:00.000Z'),
        sourceVersion: 1n,
      });

      await recomputeSettlement(tx, { tenantId, platformAccountId: PLATFORM, chargeId });
    }

    /** A charge outside the payout, to prove the payout scope does not reach past itself. */
    await tx.insert(schema.charges).values({
      tenantId,
      stripeAccountId: PLATFORM,
      stripeChargeId: 'ch_recon_outside',
      balanceTransactionId: 'txn_recon_outside',
      amountMinor: 99_000n,
      currency: 'USD',
      amountCapturedMinor: 99_000n,
      status: 'succeeded',
      paid: true,
      captured: true,
      transferDestination: MERCHANT,
      stripeCreatedAt: new Date('2026-08-26T10:00:00.000Z'),
      sourceVersion: 1n,
    });

    await tx.insert(schema.balanceTransactions).values({
      tenantId,
      stripeAccountId: PLATFORM,
      stripeBtxnId: 'txn_recon_outside',
      type: 'charge',
      sourceId: 'ch_recon_outside',
      grossMinor: 99_000n,
      feeMinor: 2_000n,
      netMinor: 97_000n,
      currency: 'USD',
      payoutId: 'po_recon_other',
      stripeCreatedAt: new Date('2026-08-26T10:00:00.000Z'),
      sourceVersion: 1n,
    });

    await tx.insert(schema.payouts).values({
      tenantId,
      stripeAccountId: PLATFORM,
      stripePayoutId: 'po_recon_1',
      amountMinor: 98_000n,
      currency: 'USD',
      status: 'paid',
      stripeCreatedAt: new Date('2026-08-27T10:00:00.000Z'),
      sourceVersion: 1n,
    });
  });
});

afterAll(async () => {
  await withoutTenant(db, async (tx) => {
    await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  });
  await close();
});

const payoutScope = {
  tenantId: '',
  stripeAccountId: PLATFORM,
  platformAccountId: PLATFORM,
  payoutId: 'po_recon_1',
  windowStart: null,
  windowEnd: null,
  mode: 'transactional' as const,
  scopeType: 'payout' as const,
  asOf: AS_OF,
};

describe('assembleSnapshot', () => {
  it('produces the same checksum for two reads of unchanged rows', async () => {
    const [first, second] = await withTenant(db, { tenantId }, async (tx) => [
      await assembleSnapshot(tx, { ...payoutScope, tenantId }),
      await assembleSnapshot(tx, { ...payoutScope, tenantId }),
    ]);

    expect(first!.checksum).toBe(second!.checksum);
    expect(first!.checksum).toHaveLength(64);
  });

  it('sorts every collection so a different query plan cannot change the result', async () => {
    const snapshot = await withTenant(db, { tenantId }, async (tx) =>
      assembleSnapshot(tx, { ...payoutScope, tenantId }),
    );

    expect(snapshot.charges.map((c) => c.id)).toEqual(['ch_recon_a', 'ch_recon_b']);
    expect(snapshot.balanceTransactions.map((b) => b.id)).toEqual(['txn_recon_a', 'txn_recon_b']);
    expect(snapshot.settlements.map((s) => s.chargeId)).toEqual(['ch_recon_a', 'ch_recon_b']);
  });

  it('keeps a payout run inside its own payout', async () => {
    const snapshot = await withTenant(db, { tenantId }, async (tx) =>
      assembleSnapshot(tx, { ...payoutScope, tenantId }),
    );

    expect(snapshot.charges.map((c) => c.id)).not.toContain('ch_recon_outside');
    expect(snapshot.balanceTransactions.every((b) => b.payoutId === 'po_recon_1')).toBe(true);
  });

  it('freezes the evaluation instant so rules never read a clock', async () => {
    const snapshot = await withTenant(db, { tenantId }, async (tx) =>
      assembleSnapshot(tx, { ...payoutScope, tenantId }),
    );

    expect(snapshot.asOf).toBe(AS_OF.toISOString());
    expect(snapshot.scopeKey).toBe('payout:po_recon_1');
    expect(snapshot.scopeType).toBe('payout');
  });

  it('carries the account state that drives suppression', async () => {
    const snapshot = await withTenant(db, { tenantId }, async (tx) =>
      assembleSnapshot(tx, { ...payoutScope, tenantId }),
    );

    expect(snapshot.accountState.payoutsEnabled).toBe(true);
    expect(snapshot.accountState.chargesEnabled).toBe(true);
    expect(snapshot.accountState.stripeAccountId).toBe(PLATFORM);
  });

  it('excludes money that already landed from a window run', async () => {
    const snapshot = await withTenant(db, { tenantId }, async (tx) =>
      assembleSnapshot(tx, {
        ...payoutScope,
        tenantId,
        payoutId: null,
        scopeType: 'platform',
        windowStart: new Date('2026-08-01T00:00:00.000Z'),
        windowEnd: new Date('2026-09-01T00:00:00.000Z'),
      }),
    );

    expect(snapshot.balanceTransactions).toHaveLength(0);
    expect(snapshot.scopeKey).toContain('window:');
  });
});
