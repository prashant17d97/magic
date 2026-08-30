const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Exports land in Excel on a finance machine, and a merchant-controlled field beginning with `=`
 * is a genuine path from a marketplace seller to a finance workstation. Prefixing with an
 * apostrophe neutralises the formula while leaving the value readable.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  const neutralised = FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix)) ? `'${text}` : text;

  return /[",\n\r]/.test(neutralised) ? `"${neutralised.replace(/"/g, '""')}"` : neutralised;
}

export function toCsvRow(cells: readonly unknown[]): string {
  return cells.map(escapeCsvCell).join(',');
}
