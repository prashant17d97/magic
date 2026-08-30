import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(100).default(20),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().default(30_000),
  REDIS_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().default(4000),
  /**
   * The interface to bind. `0.0.0.0` is right when the service owns its container. Running the
   * fleet in one container makes it wrong: a platform that picks a service's public port by
   * looking for an open one could route the console's traffic here instead.
   */
  API_HOST: z.string().default('0.0.0.0'),
  SERVICE_TOKEN: z.string().min(16),
  EXPORT_URL_TTL_SECONDS: z.coerce.number().int().default(900),
  EXPORT_DIR: z.string().default('/tmp/magic-exports'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type ApiConfig = z.infer<typeof EnvSchema>;

export const CONFIG = Symbol('MAGIC_API_CONFIG');

/**
 * The service token is the only credential the API accepts, and it has no default. A deployment
 * that forgets it fails at boot rather than exposing an internal API with an empty password.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid API configuration:\n${detail}`);
  }
  return result.data;
}
