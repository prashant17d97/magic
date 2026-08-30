import { z } from 'zod';

const ServerEnvSchema = z.object({
  API_INTERNAL_URL: z.string().default('http://localhost:4000'),
  SERVICE_TOKEN: z.string().min(16),
  SESSION_SECRET: z.string().min(32),
  REDIS_URL: z.string().min(1),
  SESSION_IDLE_MINUTES: z.coerce.number().int().default(60),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().default(12),
  EXPORT_DIR: z.string().default('/tmp/magic-exports'),
  /**
   * Whether `EXPORT_DIR` is the same storage the worker writes to. True under Docker Compose,
   * which mounts one volume into both; false wherever each service has its own filesystem. It
   * decides only how a missing file is reported, so it defaults to the honest answer.
   */
  EXPORT_STORAGE_SHARED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Server-only configuration. Nothing here is ever bundled into the client, which is the point:
 * the service token and session secret exist only in the Node process that fronts the API.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const result = ServerEnvSchema.safeParse(process.env);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid web configuration:\n${detail}`);
  }

  cached = result.data;
  return cached;
}
