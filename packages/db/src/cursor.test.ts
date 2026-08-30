import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, toPage } from './cursor.js';

describe('cursor', () => {
  it('round-trips a timestamp and id', () => {
    const cursor = { value: '2026-08-29T12:00:00.000Z', id: 'abc-123' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('survives a value containing the separator character', () => {
    const cursor = { value: 'a|b|c', id: 'id-1' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('returns null for absent or malformed input rather than throwing', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('emits a next cursor only when an extra row proves there is more', () => {
    const rows = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const full = toPage(rows, 2, (r) => ({ value: r.id, id: r.id }));
    expect(full.data).toHaveLength(2);
    expect(full.next_cursor).not.toBeNull();

    const partial = toPage(rows.slice(0, 2), 2, (r) => ({ value: r.id, id: r.id }));
    expect(partial.next_cursor).toBeNull();
  });
});
