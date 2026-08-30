import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDatabase>['db'];

export interface DatabaseOptions {
  readonly url: string;
  readonly poolMax?: number;
  readonly statementTimeoutMs?: number;
  readonly applicationName?: string;
}

/**
 * `postgres.js` is configured with two settings that matter for correctness rather than speed:
 * `prepare: false`, because prepared statements are cached per connection and would outlive the
 * `SET LOCAL` that scopes them; and an explicit statement timeout, so a runaway analytical query
 * cannot hold a connection open indefinitely on the API pool.
 */
export function createDatabase(options: DatabaseOptions) {
  const sql = postgres(options.url, {
    max: options.poolMax ?? 20,
    prepare: false,
    connection: {
      application_name: options.applicationName ?? 'magic',
      statement_timeout: options.statementTimeoutMs ?? 30_000,
    },
    types: {
      bigint: postgres.BigInt,
    },
  });

  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}

export { schema };
