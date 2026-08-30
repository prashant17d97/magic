import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

export interface TenantContext {
  readonly tenantId: string;
  readonly userId?: string;
  readonly requestId?: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export class MissingTenantContextError extends Error {
  constructor(operation: string) {
    super(
      `${operation} was issued outside a tenant context. Every query must run inside withTenant so RLS has a bound tenant.`,
    );
    this.name = 'MissingTenantContextError';
  }
}

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Opens a transaction and binds the tenant for its lifetime.
 *
 * `SET LOCAL` rather than `SET` is not a style preference. A session-level `SET` survives the
 * connection's return to the pool and leaks the previous request's tenant into the next one —
 * precisely the bug row-level security was adopted to prevent.
 */
export async function withTenant<T>(
  db: Database,
  context: TenantContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return tenantStorage.run(context, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${context.tenantId}, true)`);
      return fn(tx);
    }),
  );
}

/**
 * Opens a transaction with no tenant bound, for the handful of operations that legitimately
 * precede tenant resolution: sign-in, webhook path-key lookup, the outbox relay, the sweep
 * scheduler, and migrations.
 *
 * It does not bypass row-level security, and cannot: `magic_app` holds neither BYPASSRLS nor
 * ownership of these tables. With no tenant bound, `tenant_id = current_tenant_id()` is NULL and
 * every policy denies, so a plain SELECT inside this helper returns zero rows rather than an
 * error — which is the quietest possible failure. Every caller must therefore read through a
 * SECURITY DEFINER function that returns only the columns that operation needs. See migrations
 * 0009, 0010 and 0011 for the ones that exist.
 */
export async function withoutTenant<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}

export function currentTenantId(): string {
  const store = tenantStorage.getStore();
  if (!store) throw new MissingTenantContextError('currentTenantId()');
  return store.tenantId;
}

export function currentContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

/** Asserts a bound tenant. Repository base classes call this so a missing bind fails loudly. */
export function assertTenantContext(operation: string): TenantContext {
  const store = tenantStorage.getStore();
  if (!store) throw new MissingTenantContextError(operation);
  return store;
}
