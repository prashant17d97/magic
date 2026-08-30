import postgres from 'postgres';
import { runMigrations } from '../migrator.js';

/**
 * Drops and rebuilds the public schema. Refuses to run against production so a mistyped
 * environment variable cannot become an incident.
 */
if (process.env['NODE_ENV'] === 'production') {
  console.error('Refusing to reset the database in production.');
  process.exit(1);
}

const url = process.env['DATABASE_URL_OWNER'] ?? process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL_OWNER or DATABASE_URL must be set.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

try {
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  process.stdout.write('schema dropped\n');
  const result = await runMigrations(sql);
  process.stdout.write(`${result.applied.length} migration(s) applied.\n`);
} catch (error) {
  console.error('Reset failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
