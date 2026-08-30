import type { Redis } from 'ioredis';

export interface TokenBucketOptions {
  readonly capacity: number;
  readonly refillPerSecond: number;
}

export class RateLimitedError extends Error {
  readonly retryAfterMs: number;

  constructor(key: string, retryAfterMs: number) {
    super(`Rate limit budget exhausted for ${key}. Retry in ${retryAfterMs}ms.`);
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Stripe enforces rate limits per account, so the bucket is keyed by account too. A single busy
 * merchant then cannot starve the rest of the fleet, which is the failure mode a global limiter
 * produces at a few thousand connected accounts.
 *
 * The refill is computed in a Lua script so read-modify-write stays atomic across workers.
 */
const REFILL_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'updated')
local tokens = tonumber(bucket[1])
local updated = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  updated = now
end

local elapsed = math.max(0, now - updated) / 1000
tokens = math.min(capacity, tokens + elapsed * refill)

if tokens < requested then
  redis.call('HMSET', key, 'tokens', tokens, 'updated', now)
  redis.call('PEXPIRE', key, 60000)
  return -1
end

tokens = tokens - requested
redis.call('HMSET', key, 'tokens', tokens, 'updated', now)
redis.call('PEXPIRE', key, 60000)
return math.floor(tokens)
`;

export class TokenBucketLimiter {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async tryAcquire(key: string, options: TokenBucketOptions, cost = 1): Promise<boolean> {
    const result = await this.redis.eval(
      REFILL_SCRIPT,
      1,
      `ratelimit:${key}`,
      String(options.capacity),
      String(options.refillPerSecond),
      String(Date.now()),
      String(cost),
    );
    return Number(result) >= 0;
  }

  /**
   * Throws rather than waiting. BullMQ then reschedules the job with backoff, which is far
   * cheaper than holding a worker slot open in a sleep loop.
   */
  async acquireOrThrow(key: string, options: TokenBucketOptions, cost = 1): Promise<void> {
    const allowed = await this.tryAcquire(key, options, cost);
    if (!allowed) {
      throw new RateLimitedError(key, Math.ceil((cost / options.refillPerSecond) * 1000));
    }
  }

  async remaining(key: string): Promise<number> {
    const tokens = await this.redis.hget(`ratelimit:${key}`, 'tokens');
    return tokens === null ? Number.POSITIVE_INFINITY : Number(tokens);
  }
}
