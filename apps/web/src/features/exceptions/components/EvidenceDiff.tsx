import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatMinor } from '@/shared/lib/money';

interface Row {
  label: string;
  expected: ReactNode;
  actual: ReactNode;
  delta: ReactNode;
  isDelta?: boolean;
}

const MINOR_KEYS = /_minor$/;

/**
 * The heart of the detail panel.
 *
 * "Why is this flagged" is answered as a comparison rather than a paragraph, because that is how
 * a finance operator reads a discrepancy: expected here, actual there, difference between them.
 * Three aligned columns of tabular figures do the work that three sentences would not.
 */
export function EvidenceDiff({
  expected,
  actual,
  currency,
}: {
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  currency: string | null;
}) {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const rows: Row[] = [];

  for (const key of keys) {
    const expectedValue = expected[key];
    const actualValue = actual[key];
    const money = MINOR_KEYS.test(key) && currency !== null;

    const expectedText = money ? formatMinor(asAmount(expectedValue), currency) : display(expectedValue);
    const actualText = money ? formatMinor(asAmount(actualValue), currency) : display(actualValue);

    let deltaText: ReactNode = '—';
    if (money) {
      const expectedNumber = asBigInt(expectedValue);
      const actualNumber = asBigInt(actualValue);
      if (expectedNumber !== null && actualNumber !== null) {
        const difference = actualNumber - expectedNumber;
        deltaText = (
          <span
            className={cn(
              difference === 0n
                ? 'text-[var(--success-fg)]'
                : difference < 0n
                  ? 'text-[var(--danger-fg)]'
                  : 'text-[var(--warning-fg)]',
            )}
          >
            {difference > 0n ? '+' : ''}
            {formatMinor(difference.toString(), currency)}
          </span>
        );
      }
    }

    rows.push({
      label: key.replace(/_minor$/, '').replace(/_/g, ' '),
      expected: expectedText,
      actual: actualText,
      delta: deltaText,
      isDelta: money,
    });
  }

  if (rows.length === 0) {
    return <p className="type-body-sm text-[var(--text-secondary)]">This rule recorded no comparable figures.</p>;
  }

  return (
    <table className="w-full">
      <caption className="sr-only">Expected against actual, with the difference</caption>
      <thead>
        <tr className="border-b border-[var(--border-subtle)]">
          <th scope="col" className="type-label pb-1.5 text-left text-[var(--text-tertiary)]">
            Field
          </th>
          <th scope="col" className="type-label pb-1.5 text-right text-[var(--text-tertiary)]">
            Expected
          </th>
          <th scope="col" className="type-label pb-1.5 text-right text-[var(--text-tertiary)]">
            Actual
          </th>
          <th scope="col" className="type-label pb-1.5 text-right text-[var(--text-tertiary)]">
            Δ
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b border-[var(--border-subtle)] last:border-0">
            <td className="py-1.5 type-table text-[var(--text-secondary)]">{row.label}</td>
            <td className="numeric py-1.5 type-table text-[var(--text-primary)]">{row.expected}</td>
            <td className="numeric py-1.5 type-table text-[var(--text-primary)]">{row.actual}</td>
            <td className="numeric py-1.5 type-table font-medium">{row.delta}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function asAmount(value: unknown): string | null {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return null;
}

function asBigInt(value: unknown): bigint | null {
  const amount = asAmount(value);
  return amount === null ? null : BigInt(amount);
}
