import type Stripe from 'stripe';

/**
 * Stripe responses are validated at the boundary rather than trusted. A silent API-version shift
 * that changes a field's type should fail here, loudly, instead of propagating a wrong number
 * into a settlement row where it becomes indistinguishable from a client's real discrepancy.
 */
export function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Stripe returned a non-numeric ${field}: ${String(value)}`);
  }
  return value;
}

export function toMinor(value: number | null | undefined): bigint {
  return value === null || value === undefined ? 0n : BigInt(Math.trunc(value));
}

export function toDate(epochSeconds: number | null | undefined): Date {
  return new Date((epochSeconds ?? 0) * 1000);
}

/**
 * Reads the currency off a Stripe object, refusing a partial one.
 *
 * With Stripe disabled the projector works from the stored webhook payload rather than a
 * re-fetched object, and a payload that omits `currency` would otherwise reach the driver as
 * `undefined` and surface as a TypeError naming nothing useful. Failing here names the object.
 */
export function currencyOf(value: string | null | undefined, objectType: string, id: string): string {
  if (!value) {
    throw new Error(`Stripe ${objectType} ${id} carries no currency; the object is partial.`);
  }
  return value.toUpperCase();
}

export function idOf(value: string | { id: string } | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : value.id;
}

export function metadataOf(metadata: Stripe.Metadata | null | undefined): Record<string, string> {
  if (!metadata) return {};
  return Object.fromEntries(Object.entries(metadata).filter(([, v]) => typeof v === 'string'));
}

/**
 * A monotonic version for optimistic concurrency on out-of-order writes. Stripe's `created` is
 * second-resolution and does not change on update, so a re-fetch timestamp is folded in: two
 * writes from the same object then order by when each was observed.
 */
export function sourceVersion(created: number | null | undefined, observedAtMs: number): bigint {
  return BigInt(created ?? 0) * 1000n + BigInt(observedAtMs % 1000);
}
