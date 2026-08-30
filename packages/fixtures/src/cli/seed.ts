import { createDatabase } from '@magic/db';
import { seedDemoTenant } from '../demo.js';

/**
 * A developer's first minute in this codebase should end with a populated exception queue
 * containing known-broken scenarios, not an empty database and a README explaining what the
 * product would do if it had data.
 */
const url = process.env['DATABASE_URL_OWNER'] ?? process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL_OWNER or DATABASE_URL must be set.');
  process.exit(1);
}

const { db, close } = createDatabase({ url, applicationName: 'magic-seed' });

try {
  const started = Date.now();
  const result = await seedDemoTenant(db, {
    chargeCount: Number(process.env['SEED_CHARGE_COUNT'] ?? 600),
  });

  process.stdout.write(
    [
      '',
      '  Northwind Marketplace seeded.',
      '',
      `  tenant id        ${result.tenantId}`,
      `  tenant slug      ${result.slug}`,
      `  webhook path     /wh/stripe/${result.webhookPathKey}`,
      `  healthy charges  ${result.healthyCharges}`,
      `  runs executed    ${result.runs}`,
      `  elapsed          ${((Date.now() - started) / 1000).toFixed(1)}s`,
      '',
      '  Sign in with any of:',
      '    admin@northwind.test     admin',
      '    operator@northwind.test  member',
      '    scoped@northwind.test    member, scoped to Acme Studio',
      '    auditor@northwind.test   viewer',
      '',
      '  Password for every seeded account: magic-dev-password',
      '',
    ].join('\n'),
  );
} catch (error) {
  console.error('Seed failed:', error);
  if (error instanceof Error && error.cause) console.error('Caused by:', error.cause);
  process.exitCode = 1;
} finally {
  await close();
}
