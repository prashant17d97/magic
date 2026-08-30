import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type { Database } from '@magic/db';
import { decodeCursor, encodeCursor, schema, withTenant } from '@magic/db';
import type {
  ExceptionCounts,
  ExceptionDetail,
  ExceptionListItem,
  ExceptionStatus,
  ParsedExceptionQuery,
} from '@magic/contracts';
import { ALL_RULES } from '@magic/domain';
import { DATABASE } from '../platform/database.module.js';
import type { Principal } from '../auth/principal.js';

const RULE_NAMES = new Map(ALL_RULES.map((r) => [r.id, r.name]));

/**
 * Legal transitions. Reopening is permitted and recorded; there is no path that erases history,
 * because the auditor persona needs to see what was flagged, by whom it was closed and on what
 * evidence — not just where things ended up.
 */
const TRANSITIONS: Record<ExceptionStatus, ExceptionStatus[]> = {
  open: ['investigating', 'resolved', 'ignored'],
  investigating: ['open', 'resolved', 'ignored'],
  resolved: ['open', 'investigating'],
  ignored: ['open', 'investigating'],
};

@Injectable()
export class ExceptionsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Cursor pagination on `(last_seen_at, id)`. The tie-breaking id matters: several exceptions
   * routinely share a timestamp after one reconciliation run, and a cursor on the timestamp
   * alone would skip or repeat rows across page boundaries.
   */
  async list(
    principal: Principal,
    query: ParsedExceptionQuery,
  ): Promise<{ data: ExceptionListItem[]; next_cursor: string | null }> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const cursor = decodeCursor(query.cursor);
      const direction = query.direction === 'asc' ? asc : desc;
      const sortColumn = this.sortColumn(query.sort);

      const conditions = [eq(schema.exceptions.tenantId, principal.tenantId)];

      if (query.status?.length) conditions.push(inArray(schema.exceptions.status, query.status));
      if (query.severity?.length) conditions.push(inArray(schema.exceptions.severity, query.severity));
      if (query.rule_id) conditions.push(eq(schema.exceptions.ruleId, query.rule_id));
      if (query.account_id) conditions.push(eq(schema.exceptions.stripeAccountId, query.account_id));
      if (query.assignee_id) conditions.push(eq(schema.exceptions.assignedTo, query.assignee_id));
      if (query.currency) conditions.push(eq(schema.exceptions.currency, query.currency));
      if (query.layer) conditions.push(eq(schema.exceptions.layer, query.layer));
      if (query.from) conditions.push(gte(schema.exceptions.lastSeenAt, new Date(query.from)));
      if (query.to) conditions.push(lte(schema.exceptions.lastSeenAt, new Date(query.to)));

      if (query.q) {
        const term = `%${query.q}%`;
        const search = or(
          ilike(schema.exceptions.subjectId, term),
          ilike(schema.exceptions.narrative, term),
          ilike(schema.exceptions.ruleId, term),
        );
        if (search) conditions.push(search);
      }

      const scope = this.scopeCondition(principal);
      if (scope) conditions.push(scope);

      if (cursor && query.sort === 'last_seen_at') {
        const boundary = new Date(cursor.value);
        conditions.push(
          sql`(${schema.exceptions.lastSeenAt}, ${schema.exceptions.id}) < (${boundary}, ${cursor.id}::uuid)`,
        );
      }

      const rows = await tx
        .select({
          exception: schema.exceptions,
          accountName: schema.connectedAccounts.displayName,
          assigneeName: schema.users.displayName,
        })
        .from(schema.exceptions)
        .leftJoin(
          schema.connectedAccounts,
          and(
            eq(schema.connectedAccounts.tenantId, schema.exceptions.tenantId),
            eq(schema.connectedAccounts.stripeAccountId, schema.exceptions.stripeAccountId),
          ),
        )
        .leftJoin(schema.users, eq(schema.users.id, schema.exceptions.assignedTo))
        .where(and(...conditions))
        .orderBy(direction(sortColumn), direction(schema.exceptions.id))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page[page.length - 1];

      return {
        data: page.map((row) => this.toListItem(row.exception, row.accountName, row.assigneeName)),
        next_cursor:
          hasMore && last
            ? encodeCursor({ value: last.exception.lastSeenAt.toISOString(), id: last.exception.id })
            : null,
      };
    });
  }

  async detail(principal: Principal, id: string): Promise<ExceptionDetail> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const [row] = await tx
        .select({
          exception: schema.exceptions,
          accountName: schema.connectedAccounts.displayName,
          assigneeName: schema.users.displayName,
        })
        .from(schema.exceptions)
        .leftJoin(
          schema.connectedAccounts,
          and(
            eq(schema.connectedAccounts.tenantId, schema.exceptions.tenantId),
            eq(schema.connectedAccounts.stripeAccountId, schema.exceptions.stripeAccountId),
          ),
        )
        .leftJoin(schema.users, eq(schema.users.id, schema.exceptions.assignedTo))
        .where(and(eq(schema.exceptions.tenantId, principal.tenantId), eq(schema.exceptions.id, id)))
        .limit(1);

      if (!row) throw new NotFoundException(`Exception ${id} does not exist.`);
      this.assertInScope(principal, row.exception.stripeAccountId);

      const events = await tx
        .select({ event: schema.exceptionEvents, actorName: schema.users.displayName })
        .from(schema.exceptionEvents)
        .leftJoin(schema.users, eq(schema.users.id, schema.exceptionEvents.actorUserId))
        .where(eq(schema.exceptionEvents.exceptionId, id))
        .orderBy(asc(schema.exceptionEvents.createdAt));

      const matchedOrder = await this.matchedOrderFor(tx, principal.tenantId, row.exception.subjectId);
      const trace = (row.exception.ruleTrace ?? {}) as Record<string, unknown>;

      return {
        ...this.toListItem(row.exception, row.accountName, row.assigneeName),
        scope_key: row.exception.scopeKey,
        fingerprint: row.exception.fingerprint,
        expected: (row.exception.expected ?? {}) as Record<string, unknown>,
        actual: (row.exception.actual ?? {}) as Record<string, unknown>,
        evidence: (row.exception.evidence ?? {}) as Record<string, unknown>,
        rule_trace: {
          rule_id: String(trace['rule_id'] ?? row.exception.ruleId),
          rule_version: Number(trace['rule_version'] ?? row.exception.ruleVersion),
          layer: Number(trace['layer'] ?? row.exception.layer),
          maturity_seconds: Number(trace['maturity_seconds'] ?? 0),
          evaluated_at: String(trace['evaluated_at'] ?? row.exception.lastSeenAt.toISOString()),
          parameters: (trace['parameters'] ?? {}) as Record<string, unknown>,
          mode: String(trace['mode'] ?? 'both'),
        },
        linked_objects: this.linkedObjects(row.exception.evidence as Record<string, unknown>),
        matched_order: matchedOrder,
        history: events.map((e) => ({
          id: e.event.id.toString(),
          from_status: e.event.fromStatus as ExceptionStatus | null,
          to_status: e.event.toStatus,
          actor_type: e.event.actorType as 'user' | 'system',
          actor_user_id: e.event.actorUserId,
          actor_name: e.actorName,
          note: e.event.note,
          created_at: e.event.createdAt.toISOString(),
        })),
        resolution_note: row.exception.resolutionNote,
        resolved_at: row.exception.resolvedAt?.toISOString() ?? null,
      };
    });
  }

  async transition(
    principal: Principal,
    id: string,
    to: ExceptionStatus,
    note: string | undefined,
  ): Promise<ExceptionDetail> {
    await withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.exceptions)
        .where(and(eq(schema.exceptions.tenantId, principal.tenantId), eq(schema.exceptions.id, id)))
        .limit(1);

      if (!current) throw new NotFoundException(`Exception ${id} does not exist.`);
      this.assertInScope(principal, current.stripeAccountId);

      const from = current.status as ExceptionStatus;
      if (from === to) return;

      if (!TRANSITIONS[from].includes(to)) {
        throw new BadRequestException(
          `Cannot transition from '${from}' to '${to}'. Allowed from here: ${TRANSITIONS[from].join(', ')}.`,
        );
      }

      const closing = to === 'resolved' || to === 'ignored';

      await tx
        .update(schema.exceptions)
        .set({
          status: to,
          resolvedAt: closing ? new Date() : null,
          resolvedBy: closing ? principal.userId : null,
          resolutionNote: closing ? (note ?? null) : null,
        })
        .where(eq(schema.exceptions.id, id));

      await tx.insert(schema.exceptionEvents).values({
        tenantId: principal.tenantId,
        exceptionId: id,
        fromStatus: from,
        toStatus: to,
        actorUserId: principal.userId,
        actorType: 'user',
        note: note ?? null,
      });
    });

    return this.detail(principal, id);
  }

  /**
   * Bulk ignore and bulk assign exist. Bulk resolve does not, and the omission is the design:
   * resolving in bulk defeats the individual verification the queue exists to produce.
   */
  async bulkIgnore(principal: Principal, ids: string[], note: string): Promise<{ updated: number }> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.exceptions)
        .where(and(eq(schema.exceptions.tenantId, principal.tenantId), inArray(schema.exceptions.id, ids)));

      const eligible = rows.filter(
        (r) => this.inScope(principal, r.stripeAccountId) && (r.status === 'open' || r.status === 'investigating'),
      );
      if (eligible.length === 0) return { updated: 0 };

      await tx
        .update(schema.exceptions)
        .set({
          status: 'ignored',
          resolvedAt: new Date(),
          resolvedBy: principal.userId,
          resolutionNote: note,
        })
        .where(
          inArray(
            schema.exceptions.id,
            eligible.map((r) => r.id),
          ),
        );

      await tx.insert(schema.exceptionEvents).values(
        eligible.map((r) => ({
          tenantId: principal.tenantId,
          exceptionId: r.id,
          fromStatus: r.status,
          toStatus: 'ignored',
          actorUserId: principal.userId,
          actorType: 'user' as const,
          note,
        })),
      );

      return { updated: eligible.length };
    });
  }

  async bulkAssign(principal: Principal, ids: string[], assigneeId: string | null): Promise<{ updated: number }> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.exceptions)
        .where(and(eq(schema.exceptions.tenantId, principal.tenantId), inArray(schema.exceptions.id, ids)));

      const eligible = rows.filter((r) => this.inScope(principal, r.stripeAccountId));
      if (eligible.length === 0) return { updated: 0 };

      await tx
        .update(schema.exceptions)
        .set({ assignedTo: assigneeId })
        .where(
          inArray(
            schema.exceptions.id,
            eligible.map((r) => r.id),
          ),
        );

      await tx.insert(schema.exceptionEvents).values(
        eligible.map((r) => ({
          tenantId: principal.tenantId,
          exceptionId: r.id,
          fromStatus: r.status,
          toStatus: r.status,
          actorUserId: principal.userId,
          actorType: 'user' as const,
          note: assigneeId ? 'Reassigned.' : 'Assignment cleared.',
        })),
      );

      return { updated: eligible.length };
    });
  }

  async counts(principal: Principal): Promise<ExceptionCounts> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const scope = this.scopeCondition(principal);
      const base = scope
        ? and(eq(schema.exceptions.tenantId, principal.tenantId), scope)
        : eq(schema.exceptions.tenantId, principal.tenantId);

      const byStatus = await tx
        .select({ status: schema.exceptions.status, value: sql<number>`count(*)::int` })
        .from(schema.exceptions)
        .where(base)
        .groupBy(schema.exceptions.status);

      const bySeverity = await tx
        .select({ severity: schema.exceptions.severity, value: sql<number>`count(*)::int` })
        .from(schema.exceptions)
        .where(base)
        .groupBy(schema.exceptions.severity);

      const exposure = await tx
        .select({
          severity: schema.exceptions.severity,
          currency: schema.exceptions.currency,
          total: sql<string>`coalesce(sum(${schema.exceptions.exposureMinor}), 0)::text`,
          value: sql<number>`count(*)::int`,
        })
        .from(schema.exceptions)
        .where(and(base, inArray(schema.exceptions.status, ['open', 'investigating'])))
        .groupBy(schema.exceptions.severity, schema.exceptions.currency);

      return {
        by_status: Object.fromEntries(byStatus.map((r) => [r.status, r.value])),
        by_severity: Object.fromEntries(bySeverity.map((r) => [r.severity, r.value])),
        open_exposure: exposure
          .filter((r) => r.currency !== null)
          .map((r) => ({
            severity: r.severity as ExceptionCounts['open_exposure'][number]['severity'],
            currency: r.currency as string,
            total_minor: r.total,
            count: r.value,
          })),
      };
    });
  }

  private sortColumn(sort: ParsedExceptionQuery['sort']) {
    switch (sort) {
      case 'severity': return schema.exceptions.severity;
      case 'exposure_minor': return schema.exceptions.exposureMinor;
      case 'first_seen_at': return schema.exceptions.firstSeenAt;
      default: return schema.exceptions.lastSeenAt;
    }
  }

  /**
   * The account-scope layer. A marketplace operator is often responsible for a subset of sellers,
   * and without this a scoped member could act on another region's accounts — contained within
   * the tenant, but still wrong.
   */
  private scopeCondition(principal: Principal) {
    if (!principal.accountScope || principal.accountScope.length === 0) return null;
    return inArray(schema.exceptions.stripeAccountId, principal.accountScope);
  }

  private inScope(principal: Principal, accountId: string): boolean {
    return !principal.accountScope || principal.accountScope.includes(accountId);
  }

  private assertInScope(principal: Principal, accountId: string): void {
    if (!this.inScope(principal, accountId)) {
      throw new NotFoundException('Exception not found within your account scope.');
    }
  }

  private toListItem(
    row: typeof schema.exceptions.$inferSelect,
    accountName: string | null,
    assigneeName: string | null,
  ): ExceptionListItem {
    return {
      id: row.id,
      rule_id: row.ruleId,
      rule_name: RULE_NAMES.get(row.ruleId) ?? row.ruleId,
      rule_version: row.ruleVersion,
      layer: row.layer,
      severity: row.severity as ExceptionListItem['severity'],
      status: row.status as ExceptionStatus,
      stripe_account_id: row.stripeAccountId,
      account_display_name: accountName,
      subject_type: row.subjectType,
      subject_id: row.subjectId,
      exposure_minor: row.exposureMinor?.toString() ?? null,
      currency: row.currency,
      narrative: row.narrative,
      assigned_to: row.assignedTo,
      assignee_name: assigneeName,
      first_seen_at: row.firstSeenAt.toISOString(),
      last_seen_at: row.lastSeenAt.toISOString(),
    };
  }

  /** Object identifiers pulled out of the evidence payload so the panel can link and copy them. */
  private linkedObjects(evidence: Record<string, unknown>): { label: string; id: string; kind: string }[] {
    const kinds: Record<string, string> = {
      charge_id: 'charge',
      payout_id: 'payout',
      transfer_id: 'transfer',
      order_id: 'order',
      external_order_id: 'order',
      dispute_id: 'dispute',
      balance_transaction_id: 'balance_transaction',
      stripe_account_id: 'account',
    };

    const objects: { label: string; id: string; kind: string }[] = [];

    for (const [key, kind] of Object.entries(kinds)) {
      const value = evidence[key];
      if (typeof value === 'string' && value.length > 0) {
        objects.push({ label: key.replace(/_/g, ' '), id: value, kind });
      }
    }

    for (const key of ['balance_transaction_ids', 'refund_ids', 'reversal_ids', 'charge_ids']) {
      const value = evidence[key];
      if (Array.isArray(value)) {
        for (const id of value.slice(0, 12)) {
          if (typeof id === 'string') objects.push({ label: key.replace(/_ids$/, '').replace(/_/g, ' '), id, kind: 'object' });
        }
      }
    }

    return objects;
  }

  private async matchedOrderFor(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    tenantId: string,
    subjectId: string,
  ): Promise<ExceptionDetail['matched_order']> {
    const [settlement] = await tx
      .select()
      .from(schema.settlements)
      .where(and(eq(schema.settlements.tenantId, tenantId), eq(schema.settlements.chargeId, subjectId)))
      .limit(1);

    if (!settlement) return null;

    const [match] = await tx
      .select({ match: schema.matches, order: schema.orders })
      .from(schema.matches)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.matches.orderId))
      .where(and(eq(schema.matches.tenantId, tenantId), eq(schema.matches.settlementId, settlement.id)))
      .limit(1);

    if (!match) return null;

    return {
      id: match.order.id,
      external_order_id: match.order.externalOrderId,
      total_minor: match.order.totalMinor.toString(),
      currency: match.order.currency,
      tier: match.match.tier,
    };
  }
}
