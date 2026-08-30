/**
 * Currencies whose minor-unit exponent differs from the two-decimal default. Sharing this table
 * with the domain package would drag server code into the bundle for a lookup table, so it is
 * duplicated deliberately and kept small.
 */
const EXPONENTS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, JPY: 0, KMF: 0, KRW: 0, MGA: 0, PYG: 0,
  RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/**
 * Amounts arrive as strings and are never parsed to a number before formatting.
 *
 * BIGINT exceeds Number.MAX_SAFE_INTEGER and JSON numbers are IEEE 754 doubles, so a round trip
 * through Number is a silent corruption bug rather than a rounding inconvenience. The digits are
 * grouped by hand and only the display string reaches Intl.
 */
export function formatMinor(amountMinor: string | null | undefined, currency: string | null | undefined, locale = 'en-US'): string {
  if (amountMinor === null || amountMinor === undefined || currency === null || currency === undefined) return '—';

  const exponent = currencyExponent(currency);
  const negative = amountMinor.startsWith('-');
  const digits = (negative ? amountMinor.slice(1) : amountMinor).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent) || '0';
  const fraction = exponent > 0 ? digits.slice(digits.length - exponent) : '';

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator(locale));
  const decimal = decimalSeparator(locale);
  const symbol = currencySymbol(currency, locale);

  return `${negative ? '-' : ''}${symbol}${grouped}${exponent > 0 ? `${decimal}${fraction}` : ''}`;
}

/**
 * A delta carries an explicit sign and a directional word. A red number leaves the reader to work
 * out which way the money went; "short" and "over" do not.
 */
export function formatDelta(amountMinor: string | null | undefined, currency: string | null | undefined): {
  text: string;
  direction: 'short' | 'over' | 'balanced';
} {
  if (!amountMinor || !currency) return { text: '—', direction: 'balanced' };

  const negative = amountMinor.startsWith('-');
  const zero = /^-?0+$/.test(amountMinor);
  const formatted = formatMinor(negative ? amountMinor : `${amountMinor}`, currency);

  if (zero) return { text: formatMinor('0', currency), direction: 'balanced' };
  return {
    text: negative ? formatted : `+${formatted}`,
    direction: negative ? 'short' : 'over',
  };
}

export function formatCount(value: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Relative age beats a timestamp for triage; the exact time lives in the tooltip and detail. */
export function formatAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';

  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;

  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo` : `${Math.floor(months / 12)}y`;
}

export function formatTimestamp(iso: string | null | undefined, timeZone = 'UTC'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso));
}

function groupSeparator(locale: string): string {
  return new Intl.NumberFormat(locale).formatToParts(1_000).find((p) => p.type === 'group')?.value ?? ',';
}

function decimalSeparator(locale: string): string {
  return new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.';
}

function currencySymbol(currency: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? `${currency} `;
  } catch {
    return `${currency} `;
  }
}
