/**
 * Opaque keyset cursors. The encoded payload is the sort key plus the tie-breaking id, so
 * pagination stays stable while rows are inserted underneath the reader. OFFSET is never used
 * anywhere in this system: at page four thousand it is a scan of rows nobody will ever see.
 */
export interface Cursor {
  readonly value: string;
  readonly id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.value}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(encoded: string | undefined): Cursor | null {
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    const separator = decoded.lastIndexOf('|');
    if (separator <= 0) return null;
    const value = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    return id.length > 0 ? { value, id } : null;
  } catch {
    return null;
  }
}

/** Serialises a row to the page shape, trimming the extra row used to detect a next page. */
export function toPage<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => Cursor,
): { data: T[]; next_cursor: string | null } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : [...rows];
  const last = data[data.length - 1];
  return {
    data,
    next_cursor: hasMore && last ? encodeCursor(cursorOf(last)) : null,
  };
}
