import { createServer } from 'node:http';
import { createDatabase } from '@magic/db';
import { loadConfig } from './config.js';
import { queueDepths, startFleet } from './runtime.js';

const config = loadConfig();
const { db, close } = createDatabase({
  url: config.DATABASE_URL,
  poolMax: config.DATABASE_POOL_MAX,
  statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
  applicationName: `magic-worker-${config.WORKER_ROLE}`,
});

const fleet = startFleet(config, db);

/**
 * Queue depth is exposed rather than CPU. CPU is a lagging and misleading signal for a queue
 * worker: it looks calm while a backlog builds and spikes only once the backlog is already large.
 */
const metricsServer = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', role: config.WORKER_ROLE }));
    return;
  }

  if (request.url === '/metrics') {
    void queueDepths(fleet.queues).then((depths) => {
      const lines = [
        '# HELP queue_depth Jobs waiting or delayed on a queue.',
        '# TYPE queue_depth gauge',
        ...depths.map((d) => `queue_depth{queue="${d.queue}"} ${d.depth}`),
        '# HELP queue_active Jobs currently executing.',
        '# TYPE queue_active gauge',
        ...depths.map((d) => `queue_active{queue="${d.queue}"} ${d.active}`),
      ];
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      response.end(`${lines.join('\n')}\n`);
    });
    return;
  }

  response.writeHead(404);
  response.end();
});

metricsServer.listen(config.WORKER_METRICS_PORT, config.WORKER_METRICS_HOST);

/**
 * Workers drain rather than stop. A job killed mid-flight returns to the queue and is safe to
 * repeat, but finishing in-flight work keeps the ingestion lag flat during a rolling deploy.
 */
async function shutdown(signal: string): Promise<void> {
  fleet.logger.info({ signal }, 'Draining worker fleet.');
  metricsServer.close();
  await fleet.shutdown();
  await close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

fleet.logger.info({ role: config.WORKER_ROLE }, 'Worker fleet started.');
