import { describe, expect, it } from 'vitest';
import { currencyExponent, formatAge, formatDelta, formatMinor } from './money';

describe('formatMinor', () => {
  it('never routes an amount through Number, so BigInt-scale values survive', () => {
    expect(formatMinor('9007199254740993', 'USD')).toBe('$90,071,992,547,409.93');
    expect(formatMinor('9007199254740994', 'USD')).toBe('$90,071,992,547,409.94');
  });

  it('formats zero-decimal currencies without a fraction', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(formatMinor('125000', 'JPY')).toBe('¥125,000');
  });

  it('formats three-decimal currencies with three places', () => {
    expect(formatMinor('1234', 'KWD')).toContain('1.234');
  });

  it('keeps the sign in front of the symbol', () => {
    expect(formatMinor('-41250', 'USD')).toBe('-$412.50');
  });

  it('renders an absent amount as an em dash rather than zero', () => {
    expect(formatMinor(null, 'USD')).toBe('—');
    expect(formatMinor('100', null)).toBe('—');
  });

  it('always shows a currency, because a bare figure in a multi-currency tool is a defect', () => {
    expect(formatMinor('1000', 'GBP')).toContain('£');
    expect(formatMinor('1000', 'EUR')).toContain('€');
  });
});

describe('formatDelta', () => {
  it('labels the direction rather than relying on colour', () => {
    expect(formatDelta('-41250', 'USD')).toEqual({ text: '-$412.50', direction: 'short' });
    expect(formatDelta('41250', 'USD')).toEqual({ text: '+$412.50', direction: 'over' });
  });

  it('treats zero as balanced with no sign', () => {
    expect(formatDelta('0', 'USD')).toEqual({ text: '$0.00', direction: 'balanced' });
  });
});

describe('formatAge', () => {
  const now = Date.parse('2026-08-29T12:00:00.000Z');

  it('scales the unit to the magnitude an operator triages by', () => {
    expect(formatAge('2026-08-29T11:59:30.000Z', now)).toBe('30s');
    expect(formatAge('2026-08-29T11:30:00.000Z', now)).toBe('30m');
    expect(formatAge('2026-08-29T06:00:00.000Z', now)).toBe('6h');
    expect(formatAge('2026-08-27T12:00:00.000Z', now)).toBe('2d');
    expect(formatAge('2026-06-29T12:00:00.000Z', now)).toBe('2mo');
  });

  it('renders an absent timestamp as an em dash', () => {
    expect(formatAge(null, now)).toBe('—');
  });
});
