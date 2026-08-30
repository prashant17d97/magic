import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, lte, or, sql } from 'drizzle-orm';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { Database } from '@magic/db';
import { decodeCursor, encodeCursor, schema, withTenant, withoutTenant } from '@magic/db';
import { verifyPassword } from '@magic/security';
import type { AuditQuerySchema, ExportRecord, ExportRequestSchema, Member, MemberPatchSchema, SavedViewCreateSchema, SessionPayload } from '@magic/contracts';
import { jobIdOf, permissionsFor } from '@magic/contracts';
import type { z } from 'zod';
import { CONFIG, type ApiConfig } from '../config.js';
import { DATABASE } from '../platform/database.module.js';
import type { Principal } from '../auth/principal.js';

/**
 * Credential verification lives behind the API so the browser-facing tier never sees a password
 * hash. The BFF calls this, establishes a server-side session, and the browser receives only an
 * opaque cookie — there is no token in the browser to steal.
 */
@Injectable()
export class AuthService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async signIn(email: string, password: string): Promise<SessionPayload> {
    const rows = await withoutTenant(this.db, async (tx) =>
      tx.execute<AuthLookupRow>(sql`SELECT * FROM auth_lookup(${email}::citext)`),
    );

    const first = rows[0];

    /**
     * The same message for an unknown address and a wrong password. Distinguishing them turns
     * the sign-in form into an account-enumeration oracle, and the timing is dominated by the
     * scrypt verification either way.
     */
    const valid = first ? await verifyPassword(password, first.password_hash) : false;
    if (!first || !valid || first.status !== 'active') {
      throw new BadRequestException('Those credentials are not correct.');
    }

    const memberships = [...rows].filter((row) => row.tenant_id !== null);
    if (memberships.length === 0) {
      throw new BadRequestException('This account is not a member of any workspace.');
    }

    await withoutTenant(this.db, async (tx) => {
      await tx.execute(sql`SELECT auth_touch_login(${first.user_id}::uuid)`);
    });

    return toSession(
      { id: first.user_id, email: first.email, displayName: first.display_name },
      memberships,
      memberships[0]!.tenant_id!,
    );
  }

  /** Re-resolves a session against a chosen workspace. Used by the tenant switcher. */
  async sessionFor(userId: string, tenantId: string): Promise<SessionPayload> {
    const rows = await withoutTenant(this.db, async (tx) =>
      tx.execute<AuthLookupRow>(sql`SELECT * FROM auth_memberships(${userId}::uuid)`),
    );

    const memberships = [...rows];
    const chosen = memberships.find((row) => row.tenant_id === tenantId);
    if (!chosen) throw new NotFoundException('You are not a member of that workspace.');

    return toSession(
      { id: chosen.user_id, email: chosen.email, displayName: chosen.display_name },
      memberships,
      tenantId,
    );
  }
}

interface AuthLookupRow extends Record<string, unknown> {
  user_id: string;
  email: string;
  display_name: string;
  password_hash: string;
  status: string;
  tenant_id: string | null;
  tenant_slug: string | null;
  tenant_name: string | null;
  tenant_timezone: string | null;
  role: string | null;
  account_scope: string[] | null;
}

function toSession(
  user: { id: string; email: string; displayName: string },
  memberships: AuthLookupRow[],
  tenantId: string,
): SessionPayload {
  const active = memberships.find((row) => row.tenant_id === tenantId);
  if (!active) throw new NotFoundException('You are not a member of that workspace.');

  const role = (active.role ?? 'viewer') as SessionPayload['role'];

  return {
    user: { id: user.id, email: user.email, display_name: user.displayName },
    tenant: {
      id: active.tenant_id!,
      slug: active.tenant_slug ?? '',
      display_name: active.tenant_name ?? '',
      timezone: active.tenant_timezone ?? 'UTC',
    },
    role,
    account_scope: active.account_scope,
    permissions: permissionsFor(role),
    available_tenants: memberships.map((row) => ({
      id: row.tenant_id!,
      slug: row.tenant_slug ?? '',
      display_name: row.tenant_name ?? '',
      role: (row.role ?? 'viewer') as SessionPayload['role'],
    })),
  };
}

/**
 * Exports are asynchronous without exception. No endpoint returns a full dataset, because a
 * synchronous export of a million rows is an outage waiting for a slow month-end.
 */
@Injectable()
export class ExportsService {
  private readonly queue: Queue;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {
    this.queue = new Queue('export.generate', {
      connection: new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null }),
    });
  }

  async create(
    principal: Principal,
    body: z.output<typeof ExportRequestSchema>,
  ): Promise<ExportRecord> {
    const record = await withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      if (!principal.userId) throw new BadRequestException('An export must be attributed to a user.');

      /**
       * The account scope is snapshotted here, at generation time. Reading it when the file is
       * downloaded would let a membership widened after the request was queued widen the file.
       */
      const [row] = await tx
        .insert(schema.exports)
        .values({
          tenantId: principal.tenantId,
          requestedBy: principal.userId,
          kind: body.kind,
          format: body.format,
          filters: body.filters,
          scopeSnapshot: principal.accountScope,
          status: 'queued',
        })
        .returning();

      return row!;
    });

    await this.queue.add(
      'export.generate',
      { tenantId: principal.tenantId, exportId: record.id },
      { jobId: jobIdOf(principal.tenantId, 'export', record.id) },
    );

    return this.toRecord(record, null);
  }

  async list(principal: Principal, limit: number): Promise<{ data: ExportRecord[]; next_cursor: null }> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const rows = await tx
        .select({ record: schema.exports, requesterName: schema.users.displayName })
        .from(schema.exports)
        .leftJoin(schema.users, eq(schema.users.id, schema.exports.requestedBy))
        .where(eq(schema.exports.tenantId, principal.tenantId))
        .orderBy(desc(schema.exports.createdAt))
        .limit(limit);

      return { data: rows.map((r) => this.toRecord(r.record, r.requesterName)), next_cursor: null };
    });
  }

  async detail(principal: Principal, id: string): Promise<ExportRecord> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const [row] = await tx
        .select({ record: schema.exports, requesterName: schema.users.displayName })
        .from(schema.exports)
        .leftJoin(schema.users, eq(schema.users.id, schema.exports.requestedBy))
        .where(and(eq(schema.exports.tenantId, principal.tenantId), eq(schema.exports.id, id)))
        .limit(1);

      if (!row) throw new NotFoundException(`Export ${id} does not exist.`);
      return this.toRecord(row.record, row.requesterName);
    });
  }

  private toRecord(row: typeof schema.exports.$inferSelect, requesterName: string | null): ExportRecord {
    const expired = row.expiresAt !== null && row.expiresAt.getTime() < Date.now();

    return {
      id: row.id,
      kind: row.kind,
      format: row.format,
      status: (expired && row.status === 'ready' ? 'expired' : row.status) as ExportRecord['status'],
      row_count: row.rowCount,
      requested_by_name: requesterName,
      /** The signed URL is minted by the BFF at download time and expires in fifteen minutes. */
      download_url: row.status === 'ready' && !expired ? `/api/exports/${row.id}/download` : null,
      expires_at: row.expiresAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      error: row.error,
    };
  }
}

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(
    principal: Principal,
    query: z.output<typeof AuditQuerySchema>,
  ) {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const cursor = decodeCursor(query.cursor);
      const conditions = [eq(schema.auditLog.tenantId, principal.tenantId)];

      if (query.resource_type) conditions.push(eq(schema.auditLog.resourceType, query.resource_type));
      if (query.resource_id) conditions.push(eq(schema.auditLog.resourceId, query.resource_id));
      if (query.actor_user_id) conditions.push(eq(schema.auditLog.actorUserId, query.actor_user_id));
      if (query.action) conditions.push(eq(schema.auditLog.action, query.action));
      if (query.from) conditions.push(gte(schema.auditLog.createdAt, new Date(query.from)));
      if (query.to) conditions.push(lte(schema.auditLog.createdAt, new Date(query.to)));
      if (cursor) {
        conditions.push(
          sql`(${schema.auditLog.createdAt}, ${schema.auditLog.id}) < (${new Date(cursor.value)}, ${cursor.id}::bigint)`,
        );
      }

      const rows = await tx
        .select({ entry: schema.auditLog, actorName: schema.users.displayName })
        .from(schema.auditLog)
        .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorUserId))
        .where(and(...conditions))
        .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page[page.length - 1];

      return {
        data: page.map((r) => ({
          id: r.entry.id.toString(),
          actor_type: r.entry.actorType as 'user' | 'system' | 'api',
          actor_user_id: r.entry.actorUserId,
          actor_name: r.actorName,
          action: r.entry.action,
          resource_type: r.entry.resourceType,
          resource_id: r.entry.resourceId,
          before: (r.entry.before ?? null) as Record<string, unknown> | null,
          after: (r.entry.after ?? null) as Record<string, unknown> | null,
          ip_address: r.entry.ipAddress,
          request_id: r.entry.requestId,
          created_at: r.entry.createdAt.toISOString(),
        })),
        next_cursor:
          hasMore && last
            ? encodeCursor({ value: last.entry.createdAt.toISOString(), id: last.entry.id.toString() })
            : null,
      };
    });
  }
}

@Injectable()
export class MembersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(principal: Principal): Promise<{ data: Member[] }> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const rows = await tx
        .select({ membership: schema.memberships, user: schema.users })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(eq(schema.memberships.tenantId, principal.tenantId));

      return {
        data: rows.map((r) => ({
          id: r.membership.id,
          user_id: r.user.id,
          email: r.user.email,
          display_name: r.user.displayName,
          role: r.membership.role as Member['role'],
          account_scope: r.membership.accountScope,
          status: r.user.status as Member['status'],
          last_login_at: r.user.lastLoginAt?.toISOString() ?? null,
          created_at: r.membership.createdAt.toISOString(),
        })),
      };
    });
  }

  async patch(
    principal: Principal,
    membershipId: string,
    patch: z.output<typeof MemberPatchSchema>,
  ): Promise<Member> {
    await withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.memberships)
        .where(
          and(eq(schema.memberships.tenantId, principal.tenantId), eq(schema.memberships.id, membershipId)),
        )
        .limit(1);

      if (!existing) throw new NotFoundException('That membership does not exist in this workspace.');

      /**
       * A workspace must keep at least one admin. Removing the last one would lock every
       * remaining member out of member management with no path back except a database edit.
       */
      if (patch.role && patch.role !== 'admin' && existing.role === 'admin') {
        const admins = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(schema.memberships)
          .where(
            and(eq(schema.memberships.tenantId, principal.tenantId), eq(schema.memberships.role, 'admin')),
          );

        if ((admins[0]?.value ?? 0) <= 1) {
          throw new BadRequestException('A workspace must keep at least one admin.');
        }
      }

      await tx
        .update(schema.memberships)
        .set({
          ...(patch.role ? { role: patch.role } : {}),
          ...(patch.account_scope !== undefined ? { accountScope: patch.account_scope } : {}),
        })
        .where(eq(schema.memberships.id, membershipId));
    });

    const all = await this.list(principal);
    const updated = all.data.find((m) => m.id === membershipId);
    if (!updated) throw new NotFoundException('That membership does not exist in this workspace.');
    return updated;
  }
}

@Injectable()
export class SavedViewsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(principal: Principal, resource?: string | undefined) {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const visible = or(
        eq(schema.savedViews.shared, true),
        principal.userId ? eq(schema.savedViews.ownerUserId, principal.userId) : sql`false`,
      );

      const rows = await tx
        .select()
        .from(schema.savedViews)
        .where(
          and(
            eq(schema.savedViews.tenantId, principal.tenantId),
            ...(resource ? [eq(schema.savedViews.resource, resource)] : []),
            ...(visible ? [visible] : []),
          ),
        )
        .orderBy(desc(schema.savedViews.shared), schema.savedViews.name);

      return {
        data: rows.map((r) => ({
          id: r.id,
          name: r.name,
          resource: r.resource as 'exceptions' | 'settlements' | 'runs',
          query: r.query as Record<string, unknown>,
          shared: r.shared,
          owner_user_id: r.ownerUserId,
          created_at: r.createdAt.toISOString(),
        })),
      };
    });
  }

  async create(
    principal: Principal,
    body: z.output<typeof SavedViewCreateSchema>,
  ) {
    if (!principal.userId) throw new BadRequestException('A saved view must belong to a user.');

    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const [row] = await tx
        .insert(schema.savedViews)
        .values({
          tenantId: principal.tenantId,
          ownerUserId: principal.userId!,
          name: body.name,
          resource: body.resource,
          query: body.query,
          shared: body.shared,
        })
        .onConflictDoUpdate({
          target: [
            schema.savedViews.tenantId,
            schema.savedViews.ownerUserId,
            schema.savedViews.resource,
            schema.savedViews.name,
          ],
          set: { query: body.query, shared: body.shared },
        })
        .returning();

      return {
        id: row!.id,
        name: row!.name,
        resource: row!.resource as 'exceptions' | 'settlements' | 'runs',
        query: row!.query as Record<string, unknown>,
        shared: row!.shared,
        owner_user_id: row!.ownerUserId,
        created_at: row!.createdAt.toISOString(),
      };
    });
  }

  async remove(principal: Principal, id: string): Promise<{ deleted: boolean }> {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.savedViews)
        .where(and(eq(schema.savedViews.tenantId, principal.tenantId), eq(schema.savedViews.id, id)))
        .limit(1);

      if (!existing) throw new NotFoundException('That saved view does not exist.');
      if (existing.ownerUserId !== principal.userId && principal.role !== 'admin') {
        throw new BadRequestException('Only the owner or an admin can delete a saved view.');
      }

      await tx.delete(schema.savedViews).where(eq(schema.savedViews.id, id));
      return { deleted: true };
    });
  }
}

/**
 * A permanently failed job is unacceptable in a financial system, so the dead-letter queue is a
 * work surface rather than a graveyard. Replaying re-enqueues onto the original queue with the
 * original key, which makes the retry idempotent rather than a second execution.
 */
@Injectable()
export class OpsService {
  private readonly connection: IORedis;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) config: ApiConfig,
  ) {
    this.connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
  }

  async listDeadLetters(principal: Principal, limit: number) {
    return withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.deadLetterJobs)
        .where(eq(schema.deadLetterJobs.tenantId, principal.tenantId))
        .orderBy(desc(schema.deadLetterJobs.failedAt))
        .limit(limit);

      return {
        data: rows.map((r) => ({
          id: r.id,
          original_queue: r.originalQueue,
          job_key: r.jobKey,
          error_message: r.errorMessage,
          failed_at: r.failedAt.toISOString(),
          attempts: r.attempts,
          payload: r.payload as Record<string, unknown>,
          replayed_at: r.replayedAt?.toISOString() ?? null,
        })),
      };
    });
  }

  async replay(principal: Principal, id: string): Promise<{ replayed: boolean; queue: string }> {
    const job = await withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.deadLetterJobs)
        .where(and(eq(schema.deadLetterJobs.tenantId, principal.tenantId), eq(schema.deadLetterJobs.id, id)))
        .limit(1);

      if (!row) throw new NotFoundException(`Dead-lettered job ${id} does not exist.`);
      if (row.replayedAt) throw new BadRequestException('That job has already been replayed.');
      return row;
    });

    const queue = new Queue(job.originalQueue, { connection: this.connection });
    await queue.add(job.originalQueue, job.payload as Record<string, unknown>, { jobId: job.jobKey });
    await queue.close();

    await withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
      await tx
        .update(schema.deadLetterJobs)
        .set({ replayedAt: new Date(), replayedBy: principal.userId })
        .where(eq(schema.deadLetterJobs.id, id));
    });

    return { replayed: true, queue: job.originalQueue };
  }
}
