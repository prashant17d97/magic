import postgres from 'postgres';
import { runMigrations } from '../migrator.js';

/**
 * Migrations run as the schema owner, never as the application role. The application role must
 * not own these tables, because a table owner bypasses row-level security unless FORCE is set.
 */
const url = process.env['DATABASE_URL_OWNER'] ?? process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL_OWNER or DATABASE_URL must be set to run migrations.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

try {
  const result = await runMigrations(sql);
  for (const name of result.applied) process.stdout.write(`applied  ${name}\n`);
  for (const name of result.skipped) process.stdout.write(`skipped  ${name}\n`);
  process.stdout.write(`\n${result.applied.length} migration(s) applied.\n`);
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
