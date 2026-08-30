import { Queue, Worker, type Job } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import type { Database } from '@magic/db';
import { schema, withTenant } from '@magic/db';
import { executeRun, runMatching } from '@magic/recon';
import {
  CachedSecretsProvider,
  EnvSecretsProvider,
  StripeClientFactory,
  TokenBucketLimiter,
} from '@magic/stripe-client';
import pino, { type Logger } from 'pino';
import { QUEUES, QUEUE_POLICY, ROLE_QUEUES, type QueueName, type WorkerConfig } from './config.js';
import { jobIdOf } from '@magic/contracts';
import { OutboxRelay } from './outbox-relay.js';
import { processEvent } from './processors/event-process.js';
import { activeSweepTargets, runCompletenessCheck, sweepEvents } from './processors/sweeper.js';
import { generateExport } from './processors/export-generate.js';

export interface Fleet {
  readonly queues: Map<QueueName, Queue>;
  readonly workers: Worker[];
  readonly relay: OutboxRelay;
  readonly logger: Logger;
  shutdown(): Promise<void>;
}

/**
 * Builds the worker fleet for one role. The same image serves all three deployables and selects
 * its queues from `WORKER_ROLE`, so the difference between an ingest worker and a reconciliation
 * worker is a deployment variable rather than a separate build.
 */
export function startFleet(config: WorkerConfig, db: Database): Fleet {
  const logger = pino({ level: config.LOG_LEVEL, name: `worker:${config.WORKER_ROLE}` });
  const connection: Redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

  const queues = new Map<QueueName, Queue>();
  for (const name of Object.values(QUEUES)) {
    queues.set(name, new Queue(name, { connection }));
  }

  const stripe = config.STRIPE_ENABLED
    ? new StripeClientFactory({
        secrets: new CachedSecretsProvider(new EnvSecretsProvider()),
        limiter: new TokenBucketLimiter(connection),
        apiVersion: config.STRIPE_API_VERSION,
      })
    : null;

  const deadLetter = queues.get(QUEUES.deadLetter)!;
  const active = ROLE_QUEUES[config.WORKER_ROLE];
  const workers: Worker[] = [];

  for (const name of active) {
    const policy = QUEUE_POLICY[name];
    const worker = new Worker(
      name,
      async (job) => handle(name, job, { db, logger, stripe, config, queues }),
      { connection, concurrency: policy.concurrency, autorun: true },
    );

    /**
     * A job that exhausts its retries is preserved with full context rather than dropped. In a
     * financial system a permanently failed job is unacceptable, and it needs a human path back
     * in, which is what the replay endpoint provides.
     */
    worker.on('failed', (job, error) => {
      if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;

      const tenantId = (job.data as { tenantId?: string }).tenantId;
      logger.error({ queue: name, jobId: job.id, err: error }, 'Job exhausted its retries; moving to the DLQ.');

      void deadLetter.add('dead', {
        originalQueue: name,
        jobId: job.id,
        data: job.data,
        error: { message: error.message, stack: error.stack },
        failedAt: new Date().toISOString(),
      });

      if (tenantId) {
        void withTenant(db, { tenantId }, async (tx) => {
          await tx.insert(schema.deadLetterJobs).values({
            tenantId,
            originalQueue: name,
            jobKey: String(job.id ?? 'unknown'),
            payload: job.data as Record<string, unknown>,
            errorMessage: error.message.slice(0, 2000),
            errorStack: error.stack?.slice(0, 4000) ?? null,
            attempts: job.attemptsMade,
          });
        }).catch((err: unknown) => logger.error({ err }, 'Failed to record a dead-lettered job.'));
      }
    });

    workers.push(worker);
  }

  const relay = new OutboxRelay({
    db,
    queues: queues as ReadonlyMap<string, Queue>,
    logger,
    pollMs: config.OUTBOX_POLL_MS,
    batchSize: config.OUTBOX_BATCH_SIZE,
  });

  if (active.includes(QUEUES.eventProcess)) relay.start();

  const schedulers: NodeJS.Timeout[] = [];
  if (active.includes(QUEUES.sweepEvents)) {
    schedulers.push(
      setInterval(() => void enqueueSweeps(db, queues, logger), config.SWEEP_INTERVAL_MS),
      setInterval(() => void enqueueCompleteness(db, queues, logger), config.COMPLETENESS_INTERVAL_MS),
    );
  }

  return {
    queues,
    workers,
    relay,
    logger,
    async shutdown() {
      for (const timer of schedulers) clearInterval(timer);
      await relay.stop();
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all([...queues.values()].map((q) => q.close()));
      await connection.quit();
    },
  };
}

interface HandlerDeps {
  readonly db: Database;
  readonly logger: Logger;
  readonly stripe: StripeClientFactory | null;
  readonly config: WorkerConfig;
  readonly queues: Map<QueueName, Queue>;
}

async function handle(queue: QueueName, job: Job, deps: HandlerDeps): Promise<unknown> {
  const data = job.data as Record<string, unknown>;
  const tenantId = String(data['tenantId'] ?? '');

  switch (queue) {
    case QUEUES.eventProcess:
      await processEvent(
        { db: deps.db, logger: deps.logger, stripe: deps.stripe },
        {
          tenantId,
          stripeEventId: String(data['stripeEventId']),
          connectionId: String(data['connectionId']),
          eventType: String(data['eventType']),
          objectId: (data['objectId'] as string | null) ?? null,
          objectType: (data['objectType'] as string | null) ?? null,
          stripeAccountId: (data['stripeAccountId'] as string | null) ?? null,
        },
      );
      return { processed: true };

    case QUEUES.reconRun: {
      const outcome = await executeRun(deps.db, {
        tenantId,
        stripeAccountId: String(data['stripeAccountId']),
        platformAccountId: String(data['platformAccountId'] ?? data['stripeAccountId']),
        payoutId: (data['payoutId'] as string | null) ?? null,
        mode: (data['mode'] as 'transactional' | 'aggregate' | undefined) ?? 'transactional',
        triggeredBy: (data['triggeredBy'] as 'webhook' | 'schedule' | 'manual' | undefined) ?? 'schedule',
        triggeredByUser: (data['triggeredByUser'] as string | null) ?? null,
      });
      return outcome;
    }

    case QUEUES.matchResolve: {
      const from = new Date(String(data['from'] ?? new Date(Date.now() - 30 * 86_400_000).toISOString()));
      const to = new Date(String(data['to'] ?? new Date().toISOString()));
      return withTenant(deps.db, { tenantId }, async (tx) => runMatching(tx, { tenantId, from, to }));
    }

    case QUEUES.sweepEvents:
      return sweepEvents(
        { db: deps.db, logger: deps.logger, stripe: deps.stripe },
        { tenantId, stripeAccountId: String(data['stripeAccountId']) },
      );

    case QUEUES.sweepCompleteness:
      return runCompletenessCheck(
        { db: deps.db, logger: deps.logger, stripe: deps.stripe },
        {
          tenantId,
          stripeAccountId: String(data['stripeAccountId']),
          windowStart: new Date(String(data['windowStart'])),
          windowEnd: new Date(String(data['windowEnd'])),
        },
      );

    case QUEUES.exportGenerate:
      return generateExport(
        {
          db: deps.db,
          logger: deps.logger,
          outputDir: deps.config.EXPORT_DIR,
          urlTtlSeconds: deps.config.EXPORT_URL_TTL_SECONDS,
        },
        { tenantId, exportId: String(data['exportId']) },
      );

    case QUEUES.settlementCompute:
    case QUEUES.objectFetch:
    case QUEUES.notifyDispatch:
    case QUEUES.deadLetter:
      return { skipped: queue };

    default:
      return { skipped: queue };
  }
}

async function enqueueSweeps(db: Database, queues: Map<QueueName, Queue>, logger: Logger): Promise<void> {
  try {
    const targets = await activeSweepTargets(db);
    const queue = queues.get(QUEUES.sweepEvents);
    if (!queue) return;

    for (const target of targets) {
      await queue.add(QUEUES.sweepEvents, target, {
        jobId: jobIdOf('sweep', target.tenantId, target.stripeAccountId, Math.floor(Date.now() / 900_000)),
      });
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to enqueue the event sweep.');
  }
}

async function enqueueCompleteness(db: Database, queues: Map<QueueName, Queue>, logger: Logger): Promise<void> {
  try {
    const targets = await activeSweepTargets(db);
    const queue = queues.get(QUEUES.sweepCompleteness);
    if (!queue) return;

    const windowEnd = new Date(new Date().toISOString().slice(0, 10));
    const windowStart = new Date(windowEnd.getTime() - 86_400_000);

    for (const target of targets) {
      await queue.add(
        QUEUES.sweepCompleteness,
        { ...target, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString() },
        { jobId: jobIdOf('completeness', target.tenantId, target.stripeAccountId, windowStart.toISOString().slice(0, 10)) },
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to enqueue the completeness check.');
  }
}

/** Queue depth is what actually shows the system is behind, so it is what the HPA scales on. */
export async function queueDepths(queues: Map<QueueName, Queue>): Promise<{ queue: string; depth: number; active: number }[]> {
  const result: { queue: string; depth: number; active: number }[] = [];
  for (const [name, queue] of queues) {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    result.push({
      queue: name,
      depth: (counts['waiting'] ?? 0) + (counts['delayed'] ?? 0),
      active: counts['active'] ?? 0,
    });
  }
  return result;
}

export async function pendingOutboxCount(db: Database): Promise<number> {
  const rows = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM outbox_jobs WHERE published_at IS NULL`,
  );
  return Number(rows[0]?.count ?? 0);
}
