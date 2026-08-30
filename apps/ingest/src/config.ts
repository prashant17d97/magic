import { z } from 'zod';

/**
 * Configuration is validated at boot and the process exits non-zero if it cannot be constructed.
 * A service that starts in a degraded state discovers its missing variable on the first webhook,
 * which is the worst possible moment to find out.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(100).default(10),
  REDIS_URL: z.string().min(1),
  INGEST_PORT: z.coerce.number().int().default(4001),
  /**
   * The interface to bind. `0.0.0.0` is right when the service owns its container. Running the
   * fleet in one container makes it wrong: a platform that picks a service's public port by
   * looking for an open one could route the console's traffic here instead.
   */
  INGEST_HOST: z.string().default('0.0.0.0'),
  STRIPE_API_VERSION: z.string().default('2026-06-30'),
  SECRETS_PROVIDER: z.enum(['env', 'aws-sm', 'vault']).default('env'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().default(300),
  WEBHOOK_MAX_BODY_BYTES: z.coerce.number().int().default(1_048_576),
  WEBHOOK_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(6_000),
});

export type IngestConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): IngestConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid ingest configuration:\n${detail}`);
  }
  return result.data;
}
