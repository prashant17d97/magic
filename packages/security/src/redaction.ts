const SECRET_KEY_PATTERN = /secret|token|password|key|authorization|cookie|signature/i;
const SECRET_VALUE_PATTERN = /\b(sk|rk|whsec|pk)_[A-Za-z0-9_]{6,}/g;

const ALWAYS_REDACT = new Set([
  'authorization',
  'stripe-signature',
  'cookie',
  'set-cookie',
  'x-csrf-token',
]);

export const REDACTED = '[redacted]';

/**
 * Applied at the logger rather than at call sites. A new log statement written next month cannot
 * leak a credential by forgetting to redact, because the serialiser never sees an unredacted one.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;

  if (typeof value === 'string') {
    return value.replace(SECRET_VALUE_PATTERN, REDACTED);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      output[key] = ALWAYS_REDACT.has(lower) || SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(item, depth + 1);
    }
    return output;
  }

  return value;
}
