import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBan, faClockRotateLeft, faPause, faSatelliteDish } from '@fortawesome/free-solid-svg-icons';
import type { HealthSummary } from '@magic/contracts';
import { Amount, AmountDelta } from '@/shared/components/money/Amount';
import { Badge } from '@/shared/components/ui/Badge';
import { formatAge } from '@/shared/lib/money';

const REASONS = {
  payouts_paused: { icon: faPause, tone: 'warning' as const, label: 'Payouts paused' },
  charges_disabled: { icon: faBan, tone: 'danger' as const, label: 'Charges disabled' },
  sync_failing: { icon: faSatelliteDish, tone: 'danger' as const, label: 'Sync failing' },
  completeness_drift: { icon: faSatelliteDish, tone: 'danger' as const, label: 'Drift' },
  negative_balance: { icon: faBan, tone: 'danger' as const, label: 'Negative balance' },
};

/**
 * The "payouts paused" chip earns its place.
 *
 * Without it an operator sees suppressed checks on a quiet account and assumes the system missed
 * something. One chip converts a trust problem into an explanation.
 */
export function AccountsNeedingAttention({ accounts }: { accounts: HealthSummary['accounts_needing_attention'] }) {
  return (
    <section className="surface flex flex-col">
      <header className="border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="type-h3 text-[var(--text-primary)]">Accounts needing attention</h2>
        <p className="mt-0.5 type-caption text-[var(--text-secondary)]">
          Restricted, paused, or drifting from Stripe
        </p>
      </header>

      {accounts.length === 0 ? (
        <p className="px-4 py-8 text-center type-body-sm text-[var(--text-secondary)]">
          Every connected account is enabled and in sync.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {accounts.slice(0, 6).map((account) => {
            const reason = REASONS[account.reason];

            return (
              <li key={`${account.stripe_account_id}:${account.reason}`}>
                <Link
                  href={`/exceptions?account_id=${account.stripe_account_id}`}
                  className="flex items-start gap-3 px-4 py-3 transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)]"
                >
                  <FontAwesomeIcon
                    icon={reason.icon}
                    className="mt-1 w-3.5 text-[12px] text-[var(--text-tertiary)]"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate type-body-sm font-medium text-[var(--text-primary)]">
                        {account.display_name ?? account.stripe_account_id}
                      </span>
                      <Badge tone={reason.tone}>{reason.label}</Badge>
                    </div>
                    <p className="mt-0.5 type-caption text-[var(--text-secondary)]">{account.detail}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Amount
                      minor={account.exposure_minor}
                      currency={account.currency}
                      className="type-table text-[var(--text-primary)]"
                    />
                    <p className="type-caption text-[var(--text-tertiary)]">{account.open_exceptions} open</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Recent runs lead with the checksum delta, because that is the figure that ties to the bank
 * statement — the thing finance actually needs from this product.
 */
export function RecentRuns({ runs }: { runs: HealthSummary['recent_runs'] }) {
  return (
    <section className="surface flex flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <div>
          <h2 className="type-h3 text-[var(--text-primary)]">Recent runs</h2>
          <p className="mt-0.5 type-caption text-[var(--text-secondary)]">Payout checksum and findings raised</p>
        </div>
        <Link href="/runs" className="type-caption text-[var(--text-link)] hover:underline">
          All runs
        </Link>
      </header>

      {runs.length === 0 ? (
        <p className="px-4 py-8 text-center type-body-sm text-[var(--text-secondary)]">
          No reconciliation has run yet.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {runs.slice(0, 6).map((run) => (
            <li key={run.id}>
              <Link
                href={`/runs/${run.id}`}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)]"
              >
                <FontAwesomeIcon
                  icon={faClockRotateLeft}
                  className="w-3.5 text-[11px] text-[var(--text-tertiary)]"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate type-body-sm text-[var(--text-primary)]">
                    {run.account_display_name ?? run.stripe_account_id}
                  </p>
                  <p className="truncate type-mono-sm text-[var(--text-tertiary)]">
                    {run.payout_id ?? 'window scope'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <AmountDelta minor={run.checksum_delta_minor} currency={run.currency} className="type-table" showLabel={false} />
                  <p className="type-caption text-[var(--text-tertiary)]">
                    {run.exceptions_opened} raised · {formatAge(run.finished_at)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
