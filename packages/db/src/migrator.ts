import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from 'postgres';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface MigrationResult {
  readonly applied: string[];
  readonly skipped: string[];
}

/**
 * The password for the application role, made available to migrations as a setting.
 *
 * A migration cannot read the environment, and the application role's password must not be a
 * literal in a file that lives in version control. Binding it to a setting for the duration of
 * the transaction lets `0006` read it with `current_setting` and keeps it out of the repository.
 */
const APP_PASSWORD_SETTING = 'magic.app_password';

/**
 * A deliberately small migrator. Each file runs once, inside a transaction, recorded by name.
 * There is no down migration by design: the schema stays forward-compatible for one release, so
 * a rollback is an image swap rather than a schema change under pressure.
 */
export async function runMigrations(sql: Sql, dir: string = MIGRATIONS_DIR): Promise<MigrationResult> {
  const appPassword = process.env['MAGIC_APP_PASSWORD'] ?? '';

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const existing = await sql<{ name: string }[]>`SELECT name FROM schema_migrations`;
  const done = new Set(existing.map((r) => r.name));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (done.has(file)) {
      skipped.push(file);
      continue;
    }
    const content = await readFile(join(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx`SELECT set_config(${APP_PASSWORD_SETTING}, ${appPassword}, true)`;
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    applied.push(file);
  }

  return { applied, skipped };
}
