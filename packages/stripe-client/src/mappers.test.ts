import { describe, expect, it } from 'vitest';
import { idOf, metadataOf, requireNumber, sourceVersion, toMinor } from './mappers.js';

describe('stripe boundary mappers', () => {
  it('rejects a non-numeric amount instead of coercing it', () => {
    expect(() => requireNumber('1200', 'amount')).toThrow(TypeError);
    expect(requireNumber(1200, 'amount')).toBe(1200);
  });

  it('converts amounts to BigInt minor units, treating absent as zero', () => {
    expect(toMinor(1200)).toBe(1200n);
    expect(toMinor(null)).toBe(0n);
    expect(toMinor(undefined)).toBe(0n);
  });

  it('unwraps expandable fields whether Stripe returned an id or an object', () => {
    expect(idOf('ch_1')).toBe('ch_1');
    expect(idOf({ id: 'ch_1' })).toBe('ch_1');
    expect(idOf(null)).toBeNull();
  });

  it('keeps only string metadata values', () => {
    expect(metadataOf({ order_id: 'ORD-1', other: 'x' })).toEqual({ order_id: 'ORD-1', other: 'x' });
    expect(metadataOf(null)).toEqual({});
  });

  it('orders two observations of the same object by when each was seen', () => {
    expect(sourceVersion(1_700_000_000, 1_700_000_000_500)).toBeGreaterThan(
      sourceVersion(1_700_000_000, 1_700_000_000_100),
    );
  });
});
