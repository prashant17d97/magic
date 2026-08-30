import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(100).default(20),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().default(300_000),
  REDIS_URL: z.string().min(1),
  WORKER_ROLE: z.enum(['ingest', 'recon', 'ops', 'all']).default('all'),
  WORKER_METRICS_PORT: z.coerce.number().int().default(4002),
  /**
   * The interface to bind. `0.0.0.0` is right when the service owns its container. Running the
   * fleet in one container makes it wrong: a platform that picks a service's public port by
   * looking for an open one could route the console's traffic here instead.
   */
  WORKER_METRICS_HOST: z.string().default('0.0.0.0'),
  STRIPE_API_VERSION: z.string().default('2026-06-30'),
  SECRETS_PROVIDER: z.enum(['env', 'aws-sm', 'vault']).default('env'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  OUTBOX_POLL_MS: z.coerce.number().int().default(200),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().default(100),
  SWEEP_INTERVAL_MS: z.coerce.number().int().default(900_000),
  COMPLETENESS_INTERVAL_MS: z.coerce.number().int().default(86_400_000),
  STRIPE_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  EXPORT_BUCKET: z.string().default('magic-exports'),
  EXPORT_URL_TTL_SECONDS: z.coerce.number().int().default(900),
  EXPORT_DIR: z.string().default('/tmp/magic-exports'),
});

export type WorkerConfig = z.infer<typeof EnvSchema>;

/**
 * `STRIPE_ENABLED` is off by default so a developer can run the whole fleet against seeded data
 * without credentials. Every processor that would call Stripe checks it and degrades to working
 * from the local projection rather than failing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid worker configuration:\n${detail}`);
  }
  return result.data;
}

export const QUEUES = {
  eventProcess: 'stripe.event.process',
  objectFetch: 'stripe.object.fetch',
  settlementCompute: 'settlement.compute',
  reconRun: 'recon.run',
  matchResolve: 'match.resolve',
  exportGenerate: 'export.generate',
  sweepEvents: 'sweep.events',
  sweepCompleteness: 'sweep.completeness',
  notifyDispatch: 'notify.dispatch',
  deadLetter: 'dead.letter',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Concurrency and retry policy per queue. Sharing one queue would let a slow export starve
 * webhook processing, and a single retry policy would either give up on a rate-limited Stripe
 * call too early or hammer a genuinely broken one for hours.
 */
export const QUEUE_POLICY: Record<QueueName, { concurrency: number; attempts: number; backoff: { type: 'exponential' | 'fixed'; delay: number } }> = {
  [QUEUES.eventProcess]: { concurrency: 50, attempts: 6, backoff: { type: 'exponential', delay: 2_000 } },
  [QUEUES.objectFetch]: { concurrency: 20, attempts: 5, backoff: { type: 'exponential', delay: 1_000 } },
  [QUEUES.settlementCompute]: { concurrency: 20, attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
  [QUEUES.reconRun]: { concurrency: 4, attempts: 2, backoff: { type: 'fixed', delay: 30_000 } },
  [QUEUES.matchResolve]: { concurrency: 10, attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
  [QUEUES.exportGenerate]: { concurrency: 2, attempts: 2, backoff: { type: 'fixed', delay: 60_000 } },
  [QUEUES.sweepEvents]: { concurrency: 5, attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
  [QUEUES.sweepCompleteness]: { concurrency: 2, attempts: 2, backoff: { type: 'fixed', delay: 60_000 } },
  [QUEUES.notifyDispatch]: { concurrency: 10, attempts: 5, backoff: { type: 'exponential', delay: 2_000 } },
  [QUEUES.deadLetter]: { concurrency: 1, attempts: 1, backoff: { type: 'fixed', delay: 0 } },
};

export const ROLE_QUEUES: Record<WorkerConfig['WORKER_ROLE'], QueueName[]> = {
  ingest: [QUEUES.eventProcess, QUEUES.objectFetch, QUEUES.settlementCompute],
  recon: [QUEUES.reconRun, QUEUES.matchResolve],
  ops: [QUEUES.exportGenerate, QUEUES.sweepEvents, QUEUES.sweepCompleteness, QUEUES.notifyDispatch],
  all: Object.values(QUEUES).filter((q) => q !== QUEUES.deadLetter),
};
