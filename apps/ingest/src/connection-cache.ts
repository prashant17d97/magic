import { sql } from 'drizzle-orm';
import type { Database } from '@magic/db';
import { withoutTenant } from '@magic/db';

export interface ResolvedConnection {
  readonly connectionId: string;
  readonly tenantId: string;
  readonly stripeAccountId: string;
  readonly webhookSecretRef: string;
  readonly webhookSecretPrevRef: string | null;
  readonly secretOverlapUntil: Date | null;
  readonly status: string;
}

interface ConnectionRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  stripe_account_id: string;
  webhook_secret_ref: string;
  webhook_secret_prev_ref: string | null;
  secret_overlap_until: Date | null;
  status: string;
}

/**
 * Resolves the tenant from the opaque path key, cached briefly.
 *
 * The lookup is the first step of every webhook and must not add a database round trip to the
 * 150ms acknowledgement budget on the hot path. A five-minute TTL is short enough that pausing a
 * connection takes effect promptly and long enough that a burst costs one query, not thousands.
 */
export class ConnectionCache {
  private readonly db: Database;
  private readonly ttlMs: number;
  private readonly entries = new Map<string, { value: ResolvedConnection | null; expiresAt: number }>();

  constructor(db: Database, ttlMs = 300_000) {
    this.db = db;
    this.ttlMs = ttlMs;
  }

  async byPathKey(pathKey: string): Promise<ResolvedConnection | null> {
    const hit = this.entries.get(pathKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const value = await this.load(pathKey);
    this.entries.set(pathKey, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  invalidate(pathKey: string): void {
    this.entries.delete(pathKey);
  }

  /**
   * Read through `webhook_connection` rather than the table. The endpoint has no tenant bound at
   * this point, which is exactly what row-level security refuses, so selecting from
   * `stripe_connections` here returns nothing and every delivery answers 404.
   */
  private async load(pathKey: string): Promise<ResolvedConnection | null> {
    const rows = await withoutTenant(this.db, async (tx) =>
      tx.execute<ConnectionRow>(sql`SELECT * FROM webhook_connection(${pathKey})`),
    );

    const row = rows[0];
    if (!row || row.status !== 'active') return null;

    return {
      connectionId: row.id,
      tenantId: row.tenant_id,
      stripeAccountId: row.stripe_account_id,
      webhookSecretRef: row.webhook_secret_ref,
      webhookSecretPrevRef: row.webhook_secret_prev_ref,
      secretOverlapUntil: row.secret_overlap_until,
      status: row.status,
    };
  }
}
