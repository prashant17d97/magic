import Link from 'next/link';
import type { HealthSummary, Severity } from '@magic/contracts';
import { Amount } from '@/shared/components/money/Amount';
import { SeverityIndicator } from '@/shared/components/ui/SeverityIndicator';
import { formatCount } from '@/shared/lib/money';

const ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

/**
 * Open exposure grouped by severity and currency.
 *
 * Currencies are never summed together. Reconciliation happens within a settlement currency, and
 * a single blended total would be a number that means nothing and looks authoritative.
 */
export function ExposurePanel({ exposure }: { exposure: HealthSummary['exposure'] }) {
  const bySeverity = new Map<Severity, HealthSummary['exposure']>();
  for (const row of exposure) {
    bySeverity.set(row.severity, [...(bySeverity.get(row.severity) ?? []), row]);
  }

  const total = exposure.reduce((sum, row) => sum + row.count, 0);

  return (
    <section className="surface flex flex-col">
      <header className="border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="type-h3 text-[var(--text-primary)]">Open exposure</h2>
        <p className="mt-0.5 type-caption text-[var(--text-secondary)]">
          {total === 0 ? 'Nothing open' : `${formatCount(total)} finding${total === 1 ? '' : 's'} awaiting a verdict`}
        </p>
      </header>

      <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
        {ORDER.map((severity) => {
          const rows = bySeverity.get(severity) ?? [];
          if (rows.length === 0) return null;

          return (
            <Link
              key={severity}
              href={`/exceptions?status=open&severity=${severity}`}
              className="flex items-center justify-between gap-4 px-4 py-2.5 transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)]"
            >
              <SeverityIndicator severity={severity} />

              <div className="flex items-center gap-5">
                <div className="flex flex-col items-end gap-0.5">
                  {rows.map((row) => (
                    <Amount
                      key={row.currency}
                      minor={row.total_minor}
                      currency={row.currency}
                      className="type-table font-medium text-[var(--text-primary)]"
                    />
                  ))}
                </div>
                <span className="w-10 text-right type-table numeric text-[var(--text-secondary)]">
                  {formatCount(rows.reduce((sum, row) => sum + row.count, 0))}
                </span>
              </div>
            </Link>
          );
        })}

        {exposure.length === 0 ? (
          <p className="px-4 py-8 text-center type-body-sm text-[var(--text-secondary)]">
            No open exposure in any currency.
          </p>
        ) : null}
      </div>
    </section>
  );
}
