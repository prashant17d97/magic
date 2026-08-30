import { z } from 'zod';

/**
 * The database stores only `*_ref` pointers. A full dump of Postgres — the largest and most
 * frequently copied artefact in the system — therefore yields no usable credential.
 */
export interface SecretsProvider {
  get(ref: string): Promise<string>;
}

export const SecretsProviderKind = z.enum(['env', 'aws-sm', 'vault']);

/**
 * Development provider. A reference resolves to an environment variable of the same name, so a
 * local run needs no secret manager while the calling code stays identical to production.
 */
export class EnvSecretsProvider implements SecretsProvider {
  async get(ref: string): Promise<string> {
    const value = process.env[ref];
    if (!value) throw new Error(`Secret reference ${ref} is not present in the environment.`);
    return value;
  }
}

/** Wraps any provider with a short TTL cache. The webhook path reads a secret on every request. */
export class CachedSecretsProvider implements SecretsProvider {
  private readonly inner: SecretsProvider;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();

  constructor(inner: SecretsProvider, ttlMs = 300_000) {
    this.inner = inner;
    this.ttlMs = ttlMs;
  }

  async get(ref: string): Promise<string> {
    const hit = this.cache.get(ref);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const value = await this.inner.get(ref);
    this.cache.set(ref, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  invalidate(ref: string): void {
    this.cache.delete(ref);
  }
}
