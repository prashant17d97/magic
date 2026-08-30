import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type { Database } from '@magic/db';
import { decodeCursor, encodeCursor, schema, withTenant } from '@magic/db';
import { ALL_RULES, ruleById } from '@magic/domain';
import { executeRun } from '@magic/recon';
import type {
  AccountListItem,
  CreateRunSchema,
  RunDetail,
  RunListItem,
  RuleSetting,
  RulePatchSchema,
  RunQuerySchema,
  SettlementDetail,
  SettlementListItem,
  SettlementQuerySchema,
} from '@magic/contracts';
import type { z } from 'zod';
import { DATABASE } from '../platform/database.module.js';
import type { Principal } from '../auth/principal.js';

@Injectable()
export class RunsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(
    principal: Principal,
    query: z.output<typeof RunQuerySchema>,
  ): Promise<{ data: RunListItem[]; next_cursor: string | null }> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const cursor = decodeCursor(query.cursor);
      const conditions = [eq(schema.reconciliationRuns.tenantId, principal.tenantId)];

      if (query.account_id) conditions.push(eq(schema.reconciliationRuns.stripeAccountId, query.account_id));
      if (query.status) conditions.push(eq(schema.reconciliationRuns.status, query.status));
      if (query.scope_type) conditions.push(eq(schema.reconciliationRuns.scopeType, query.scope_type));
      if (principal.accountScope?.length) {
        conditions.push(inArray(schema.reconciliationRuns.stripeAccountId, principal.accountScope));
      }
      if (cursor) {
        conditions.push(
          sql`(${schema.reconciliationRuns.createdAt}, ${schema.reconciliationRuns.id}) < (${new Date(cursor.value)}, ${cursor.id}::uuid)`,
        );
      }

      const rows = await tx
        .select({ run: schema.reconciliationRuns, accountName: schema.connectedAccounts.displayName })
        .from(schema.reconciliationRuns)
        .leftJoin(
          schema.connectedAccounts,
          and(
            eq(schema.connectedAccounts.tenantId, schema.reconciliationRuns.tenantId),
            eq(schema.connectedAccounts.stripeAccountId, schema.reconciliationRuns.stripeAccountId),
          ),
        )
        .where(and(...conditions))
        .orderBy(desc(schema.reconciliationRuns.createdAt), desc(schema.reconciliationRuns.id))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page[page.length - 1];

      return {
        data: page.map((r) => toRunListItem(r.run, r.accountName)),
        next_cursor:
          hasMore && last ? encodeCursor({ value: last.run.createdAt.toISOString(), id: last.run.id }) : null,
      };
    });
  }

  async detail(principal: Principal, id: string): Promise<RunDetail> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const [row] = await tx
        .select({ run: schema.reconciliationRuns, accountName: schema.connectedAccounts.displayName })
        .from(schema.reconciliationRuns)
        .leftJoin(
          schema.connectedAccounts,
          and(
            eq(schema.connectedAccounts.tenantId, schema.reconciliationRuns.tenantId),
            eq(schema.connectedAccounts.stripeAccountId, schema.reconciliationRuns.stripeAccountId),
          ),
        )
        .where(
          and(eq(schema.reconciliationRuns.tenantId, principal.tenantId), eq(schema.reconciliationRuns.id, id)),
        )
        .limit(1);

      if (!row) throw new NotFoundException(`Run ${id} does not exist.`);

      const [txnCount] = await tx.execute<{ count: string }>(sql`
        SELECT count(*)::text AS count FROM balance_transactions
        WHERE tenant_id = ${principal.tenantId}::uuid AND payout_id = ${row.run.payoutId}
      `);

      const exceptions = await tx
        .select()
        .from(schema.exceptions)
        .where(
          and(
            eq(schema.exceptions.tenantId, principal.tenantId),
            eq(schema.exceptions.lastSeenRunId, id),
          ),
        )
        .orderBy(asc(schema.exceptions.layer), asc(schema.exceptions.ruleId));

      return {
        ...toRunListItem(row.run, row.accountName),
        payout_amount_minor: row.run.payoutAmountMinor?.toString() ?? null,
        reconstructed_minor: row.run.reconstructedMinor?.toString() ?? null,
        balance_transaction_count: Number(txnCount?.count ?? 0),
        error: row.run.error,
        exceptions: exceptions.map((e) => ({
          id: e.id,
          rule_id: e.ruleId,
          severity: e.severity as RunDetail['exceptions'][number]['severity'],
          narrative: e.narrative,
          exposure_minor: e.exposureMinor?.toString() ?? null,
          currency: e.currency,
        })),
      };
    });
  }

  /**
   * A manual re-run is safe by construction: identity is `(rule_id, subject_id, scope_key)`, so a
   * re-run updates the findings that still hold and closes the ones that no longer do. It cannot
   * duplicate a finding and it cannot resurrect one an operator resolved unless the facts moved.
   */
  async trigger(
    principal: Principal,
    body: z.output<typeof CreateRunSchema>,
  ): Promise<RunListItem> {
    if (principal.accountScope?.length && !principal.accountScope.includes(body.account_id)) {
      throw new NotFoundException('That account is outside your scope.');
    }

    const [connection] = await withTenant(this.db, { tenantId: principal.tenantId }, async (tx) =>
      tx
        .select()
        .from(schema.stripeConnections)
        .where(eq(schema.stripeConnections.tenantId, principal.tenantId))
        .limit(1),
    );

    if (!connection) throw new BadRequestException('This tenant has no Stripe connection configured.');

    const outcome = await executeRun(this.db, {
      tenantId: principal.tenantId,
      stripeAccountId: body.account_id,
      platformAccountId: connection.stripeAccountId,
      payoutId: body.payout_id ?? null,
      mode: body.mode ?? 'transactional',
      triggeredBy: 'manual',
      triggeredByUser: principal.userId,
    });

    const detail = await this.detail(principal, outcome.runId);
    return detail;
  }
}

function toRunListItem(
  run: typeof schema.reconciliationRuns.$inferSelect,
  accountName: string | null,
): RunListItem {
  return {
    id: run.id,
    stripe_account_id: run.stripeAccountId,
    account_display_name: accountName,
    scope_type: run.scopeType as RunListItem['scope_type'],
    payout_id: run.payoutId,
    mode: run.mode as RunListItem['mode'],
    status: run.status as RunListItem['status'],
    rule_version: run.ruleVersion,
    objects_evaluated: run.objectsEvaluated,
    exceptions_opened: run.exceptionsOpened,
    exceptions_closed: run.exceptionsClosed,
    checksum_delta_minor: run.checksumDeltaMinor?.toString() ?? null,
    currency: run.currency,
    snapshot_checksum: run.snapshotChecksum,
    triggered_by: run.triggeredBy,
    started_at: run.startedAt?.toISOString() ?? null,
    finished_at: run.finishedAt?.toISOString() ?? null,
    created_at: run.createdAt.toISOString(),
  };
}

/**
 * The settlement explorer. Charge type is available as a filter and a detail field, and never
 * structures the table — the whole architecture exists to keep it out of the surfaces above the
 * settlement boundary.
 */
@Injectable()
export class SettlementsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(
    principal: Principal,
    query: z.output<typeof SettlementQuerySchema>,
  ): Promise<{ data: SettlementListItem[]; next_cursor: string | null }> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const cursor = decodeCursor(query.cursor);
      const conditions = [eq(schema.settlements.tenantId, principal.tenantId)];

      if (query.account_id) conditions.push(eq(schema.settlements.merchantAccountId, query.account_id));
      if (query.charge_type) conditions.push(eq(schema.settlements.chargeType, query.charge_type));
      if (query.status) conditions.push(eq(schema.settlements.settlementStatus, query.status));
      if (query.currency) conditions.push(eq(schema.settlements.currency, query.currency));
      if (query.from) conditions.push(gte(schema.settlements.chargedAt, new Date(query.from)));
      if (query.to) conditions.push(lte(schema.settlements.chargedAt, new Date(query.to)));
      if (query.match_tier) conditions.push(eq(schema.matches.tier, query.match_tier));
      if (principal.accountScope?.length) {
        conditions.push(inArray(schema.settlements.merchantAccountId, principal.accountScope));
      }
      if (query.q) {
        const term = `%${query.q}%`;
        const search = or(ilike(schema.settlements.chargeId, term), ilike(schema.settlements.payoutId, term));
        if (search) conditions.push(search);
      }
      if (cursor) {
        conditions.push(
          sql`(${schema.settlements.chargedAt}, ${schema.settlements.id}) < (${new Date(cursor.value)}, ${cursor.id}::uuid)`,
        );
      }

      const rows = await tx
        .select({
          settlement: schema.settlements,
          merchantName: schema.connectedAccounts.displayName,
          match: schema.matches,
        })
        .from(schema.settlements)
        .leftJoin(
          schema.connectedAccounts,
          and(
            eq(schema.connectedAccounts.tenantId, schema.settlements.tenantId),
            eq(schema.connectedAccounts.stripeAccountId, schema.settlements.merchantAccountId),
          ),
        )
        .leftJoin(schema.matches, eq(schema.matches.settlementId, schema.settlements.id))
        .where(and(...conditions))
        .orderBy(desc(schema.settlements.chargedAt), desc(schema.settlements.id))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page[page.length - 1];

      return {
        data: page.map((r) => toSettlementListItem(r.settlement, r.merchantName, r.match)),
        next_cursor:
          hasMore && last
            ? encodeCursor({ value: last.settlement.chargedAt.toISOString(), id: last.settlement.id })
            : null,
      };
    });
  }

  async detail(principal: Principal, chargeId: string): Promise<SettlementDetail> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const [row] = await tx
        .select({
          settlement: schema.settlements,
          merchantName: schema.connectedAccounts.displayName,
          match: schema.matches,
          charge: schema.charges,
        })
        .from(schema.settlements)
        .leftJoin(
          schema.connectedAccounts,
          and(
            eq(schema.connectedAccounts.tenantId, schema.settlements.tenantId),
            eq(schema.connectedAccounts.stripeAccountId, schema.settlements.merchantAccountId),
          ),
        )
        .leftJoin(schema.matches, eq(schema.matches.settlementId, schema.settlements.id))
        .leftJoin(
          schema.charges,
          and(
            eq(schema.charges.tenantId, schema.settlements.tenantId),
            eq(schema.charges.stripeChargeId, schema.settlements.chargeId),
          ),
        )
        .where(and(eq(schema.settlements.tenantId, principal.tenantId), eq(schema.settlements.chargeId, chargeId)))
        .limit(1);

      if (!row) throw new NotFoundException(`Settlement for ${chargeId} does not exist.`);

      const openExceptions = await tx
        .select()
        .from(schema.exceptions)
        .where(
          and(
            eq(schema.exceptions.tenantId, principal.tenantId),
            eq(schema.exceptions.subjectId, chargeId),
            inArray(schema.exceptions.status, ['open', 'investigating']),
          ),
        );

      const s = row.settlement;
      const postings = [
        { account_id: s.fundsHolderAccountId, kind: 'customer_gross', amount_minor: s.customerGrossMinor.toString(), currency: s.currency, source: chargeId, actual: true },
        { account_id: s.fundsHolderAccountId, kind: 'processing_fee', amount_minor: s.processingFeeMinor.toString(), currency: s.currency, source: chargeId, actual: true },
        { account_id: s.fundsHolderAccountId, kind: 'platform_revenue', amount_minor: s.platformRevenueMinor.toString(), currency: s.currency, source: row.charge?.applicationFeeId ?? chargeId, actual: s.platformRevenueMinor > 0n },
        { account_id: s.merchantAccountId, kind: 'merchant_net', amount_minor: s.merchantNetMinor.toString(), currency: s.currency, source: row.charge?.transferId ?? chargeId, actual: true },
      ];

      if (s.refundedMinor > 0n) {
        postings.push({
          account_id: s.fundsHolderAccountId,
          kind: 'refund',
          amount_minor: (-s.refundedMinor).toString(),
          currency: s.currency,
          source: chargeId,
          actual: true,
        });
      }

      return {
        ...toSettlementListItem(s, row.merchantName, row.match),
        fee_bearer: s.feeBearer,
        settled_at: s.settledAt?.toISOString() ?? null,
        computed_at: s.computedAt.toISOString(),
        charge_type_confidence: row.charge?.chargeTypeConfidence ?? null,
        charge_type_signals: (row.charge?.chargeTypeSignals ?? null) as Record<string, unknown> | null,
        postings,
        linked_objects: [
          { label: 'charge', id: chargeId, kind: 'charge' },
          ...(row.charge?.paymentIntentId
            ? [{ label: 'payment intent', id: row.charge.paymentIntentId, kind: 'payment_intent' }]
            : []),
          ...(row.charge?.transferId ? [{ label: 'transfer', id: row.charge.transferId, kind: 'transfer' }] : []),
          ...(row.charge?.applicationFeeId
            ? [{ label: 'application fee', id: row.charge.applicationFeeId, kind: 'application_fee' }]
            : []),
          ...(s.payoutId ? [{ label: 'payout', id: s.payoutId, kind: 'payout' }] : []),
        ],
        open_exceptions: openExceptions.map((e) => ({
          id: e.id,
          rule_id: e.ruleId,
          severity: e.severity as SettlementDetail['open_exceptions'][number]['severity'],
          narrative: e.narrative,
        })),
      };
    });
  }
}

function toSettlementListItem(
  s: typeof schema.settlements.$inferSelect,
  merchantName: string | null,
  match: typeof schema.matches.$inferSelect | null,
): SettlementListItem {
  return {
    id: s.id,
    charge_id: s.chargeId,
    charge_type: s.chargeType as SettlementListItem['charge_type'],
    merchant_account_id: s.merchantAccountId,
    merchant_display_name: merchantName,
    funds_holder_account_id: s.fundsHolderAccountId,
    currency: s.currency,
    customer_gross_minor: s.customerGrossMinor.toString(),
    processing_fee_minor: s.processingFeeMinor.toString(),
    platform_revenue_minor: s.platformRevenueMinor.toString(),
    merchant_net_minor: s.merchantNetMinor.toString(),
    refunded_minor: s.refundedMinor.toString(),
    settlement_status: s.settlementStatus as SettlementListItem['settlement_status'],
    payout_id: s.payoutId,
    match_tier: (match?.tier ?? null) as SettlementListItem['match_tier'],
    match_confidence: match?.confidence ?? null,
    charged_at: s.chargedAt.toISOString(),
  };
}

@Injectable()
export class AccountsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Sorted by exposure descending: the accounts costing the most money belong at the top. */
  async list(principal: Principal): Promise<{ data: AccountListItem[]; next_cursor: null }> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const rows = await tx
        .select({
          account: schema.connectedAccounts,
          openCount: sql<number>`(
            SELECT count(*)::int FROM exceptions e
             WHERE e.tenant_id = ${principal.tenantId}::uuid
               AND e.stripe_account_id = ${schema.connectedAccounts.stripeAccountId}
               AND e.status IN ('open','investigating')
          )`,
          exposure: sql<string>`(
            SELECT coalesce(sum(e.exposure_minor), 0)::text FROM exceptions e
             WHERE e.tenant_id = ${principal.tenantId}::uuid
               AND e.stripe_account_id = ${schema.connectedAccounts.stripeAccountId}
               AND e.status IN ('open','investigating')
          )`,
          drift: sql<number>`coalesce((
            SELECT sum(abs(c.drift))::int FROM completeness_checks c
             WHERE c.tenant_id = ${principal.tenantId}::uuid
               AND c.stripe_account_id = ${schema.connectedAccounts.stripeAccountId}
               AND c.checked_at > now() - interval '2 days'
          ), 0)`,
        })
        .from(schema.connectedAccounts)
        .where(
          and(
            eq(schema.connectedAccounts.tenantId, principal.tenantId),
            ...(principal.accountScope?.length
              ? [inArray(schema.connectedAccounts.stripeAccountId, principal.accountScope)]
              : []),
          ),
        );

      const data = rows
        .map((r) => ({
          id: r.account.id,
          stripe_account_id: r.account.stripeAccountId,
          display_name: r.account.displayName,
          account_type: r.account.accountType,
          country: r.account.country,
          default_currency: r.account.defaultCurrency,
          charges_enabled: r.account.chargesEnabled,
          payouts_enabled: r.account.payoutsEnabled,
          requirements_disabled_reason: r.account.requirementsDisabledReason,
          synced_at: r.account.syncedAt?.toISOString() ?? null,
          completeness_drift: r.drift,
          open_exception_count: r.openCount,
          open_exposure_minor: r.exposure,
        }))
        .sort((a, b) => Number(b.open_exposure_minor ?? 0) - Number(a.open_exposure_minor ?? 0));

      return { data, next_cursor: null };
    });
  }

  async completeness(principal: Principal, stripeAccountId: string) {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.completenessChecks)
        .where(
          and(
            eq(schema.completenessChecks.tenantId, principal.tenantId),
            eq(schema.completenessChecks.stripeAccountId, stripeAccountId),
          ),
        )
        .orderBy(desc(schema.completenessChecks.windowStart))
        .limit(60);

      return {
        data: rows.map((r) => ({
          object_type: r.objectType,
          window_start: r.windowStart.toISOString(),
          window_end: r.windowEnd.toISOString(),
          remote_count: r.remoteCount,
          local_count: r.localCount,
          drift: r.drift ?? 0,
          checked_at: r.checkedAt.toISOString(),
        })),
        next_cursor: null,
      };
    });
  }
}

/**
 * Rules are global and versioned like code; only their parameters are tenant-tunable. The ignore
 * rate is surfaced next to each rule because it is the tuning signal — a rule ignored eighty per
 * cent of the time is producing noise, and showing that here makes tuning routine rather than a
 * project.
 */
@Injectable()
export class RulesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(principal: Principal): Promise<RuleSetting[]> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const overrides = await tx
        .select()
        .from(schema.tenantRuleSettings)
        .where(eq(schema.tenantRuleSettings.tenantId, principal.tenantId));

      const stats = await tx
        .select({
          ruleId: schema.exceptions.ruleId,
          raised: sql<number>`count(*)::int`,
          ignored: sql<number>`count(*) FILTER (WHERE ${schema.exceptions.status} = 'ignored')::int`,
        })
        .from(schema.exceptions)
        .where(
          and(
            eq(schema.exceptions.tenantId, principal.tenantId),
            gte(schema.exceptions.firstSeenAt, new Date(Date.now() - 30 * 86_400_000)),
          ),
        )
        .groupBy(schema.exceptions.ruleId);

      const overrideById = new Map(overrides.map((o) => [o.ruleId, o]));
      const statsById = new Map(stats.map((s) => [s.ruleId, s]));

      return ALL_RULES.map((rule) => {
        const override = overrideById.get(rule.id);
        const stat = statsById.get(rule.id);
        const raised = stat?.raised ?? 0;
        const ignored = stat?.ignored ?? 0;

        return {
          rule_id: rule.id,
          name: rule.name,
          description: rule.description,
          layer: rule.layer,
          charge_types: rule.chargeTypes ? [...rule.chargeTypes] : null,
          mode: rule.mode,
          default_severity: rule.severity,
          default_maturity_seconds: rule.maturitySeconds,
          enabled: override?.enabled ?? true,
          severity: (override?.severityOverride ?? rule.severity) as RuleSetting['severity'],
          maturity_seconds: override?.maturitySeconds ?? rule.maturitySeconds,
          parameters: { ...rule.defaultParameters, ...((override?.parameters ?? {}) as Record<string, unknown>) },
          raised_30d: raised,
          ignored_30d: ignored,
          ignore_rate: raised === 0 ? 0 : Number((ignored / raised).toFixed(3)),
        };
      });
    });
  }

  async patch(
    principal: Principal,
    ruleId: string,
    patch: z.output<typeof RulePatchSchema>,
  ): Promise<RuleSetting> {
    if (!ruleById(ruleId)) throw new NotFoundException(`Rule ${ruleId} is not in the registry.`);

    await withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      await tx
        .insert(schema.tenantRuleSettings)
        .values({
          tenantId: principal.tenantId,
          ruleId,
          enabled: patch.enabled ?? true,
          severityOverride: patch.severity ?? null,
          maturitySeconds: patch.maturity_seconds ?? null,
          parameters: patch.parameters ?? {},
          updatedBy: principal.userId,
        })
        .onConflictDoUpdate({
          target: [schema.tenantRuleSettings.tenantId, schema.tenantRuleSettings.ruleId],
          set: {
            ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
            ...(patch.severity !== undefined ? { severityOverride: patch.severity } : {}),
            ...(patch.maturity_seconds !== undefined ? { maturitySeconds: patch.maturity_seconds } : {}),
            ...(patch.parameters !== undefined ? { parameters: patch.parameters } : {}),
            updatedBy: principal.userId,
            updatedAt: new Date(),
          },
        });
    });

    const all = await this.list(principal);
    const updated = all.find((r) => r.rule_id === ruleId);
    if (!updated) throw new NotFoundException(`Rule ${ruleId} is not in the registry.`);
    return updated;
  }
}
