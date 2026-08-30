import { createDatabase } from '@magic/db';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const config = loadConfig();
const { db, close } = createDatabase({
  url: config.DATABASE_URL,
  poolMax: config.DATABASE_POOL_MAX,
  applicationName: 'magic-ingest',
});

const app = buildServer({ config, db });

/**
 * Graceful shutdown matters more here than anywhere else: a webhook cut off mid-transaction is a
 * retry, but a listener killed while draining is a rejected delivery Stripe has to redeliver.
 */
async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Draining ingest.');
  await app.close();
  await close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.INGEST_PORT, host: config.INGEST_HOST });
