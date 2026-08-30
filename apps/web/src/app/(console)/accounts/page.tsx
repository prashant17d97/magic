import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBan, faCircleCheck, faPause } from '@fortawesome/free-solid-svg-icons';
import type { AccountListItem } from '@magic/contracts';
import { fetchFromApi } from '@/shared/lib/api-proxy';
import { readSession } from '@/shared/lib/session';
import { Badge } from '@/shared/components/ui/Badge';
import { Amount } from '@/shared/components/money/Amount';
import { ObjectId } from '@/shared/components/money/ObjectId';
import { EmptyState } from '@/shared/components/feedback/States';
import { formatAge, formatCount } from '@/shared/lib/money';
import { TopBar } from '../TopBar';

export const metadata: Metadata = { title: 'Accounts' };
export const dynamic = 'force-dynamic';

/**
 * Sorted by open exposure descending. The accounts costing the most money are the ones an
 * operator wants at the top; alphabetical order would be tidier and useless.
 */
export default async function AccountsPage() {
  const session = await readSession();
  if (!session) redirect('/sign-in');

  const { data } = await fetchFromApi<{ data: AccountListItem[] }>('/v1/accounts');

  return (
    <>
      <TopBar title="Connected accounts" description="State, completeness and open exposure per account" />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {data.length === 0 ? (
          <div className="surface">
            <EmptyState
              variant="not-started"
              title="No connected accounts"
              body="Accounts appear here once a Stripe connection is configured and synced."
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {data.map((account) => {
              const healthy = account.charges_enabled && account.payouts_enabled && account.completeness_drift === 0;

              return (
                <Link
                  key={account.id}
                  href={`/exceptions?account_id=${account.stripe_account_id}`}
                  className="surface flex flex-col gap-3 p-4 transition-colors duration-[var(--duration-instant)] hover:border-[var(--border-default)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate type-h3 text-[var(--text-primary)]">
                        {account.display_name ?? account.stripe_account_id}
                      </p>
                      <ObjectId id={account.stripe_account_id} />
                    </div>
                    {healthy ? (
                      <FontAwesomeIcon
                        icon={faCircleCheck}
                        className="mt-1 shrink-0 text-[13px] text-[var(--success-fg)]"
                        title="Healthy — no indicator needed"
                      />
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {!account.charges_enabled ? (
                      <Badge tone="danger" icon={faBan}>
                        Charges disabled
                      </Badge>
                    ) : null}
                    {!account.payouts_enabled ? (
                      <Badge tone="warning" icon={faPause}>
                        Payouts paused
                      </Badge>
                    ) : null}
                    {account.completeness_drift !== 0 ? (
                      <Badge tone="danger">{formatCount(account.completeness_drift)} drift</Badge>
                    ) : null}
                    {account.account_type ? <Badge tone="muted">{account.account_type}</Badge> : null}
                    {account.country ? <Badge tone="muted">{account.country}</Badge> : null}
                  </div>

                  {!account.payouts_enabled ? (
                    <p className="type-caption text-[var(--text-secondary)]">
                      Payout checks are suppressed for this account, so a missing payout is not reported as a finding.
                    </p>
                  ) : null}

                  <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-[var(--border-subtle)] pt-3">
                    <div>
                      <dt className="type-caption text-[var(--text-tertiary)]">Open</dt>
                      <dd className="m-0 mt-0.5 type-body-sm numeric text-[var(--text-primary)]">
                        {formatCount(account.open_exception_count)}
                      </dd>
                    </div>
                    <div>
                      <dt className="type-caption text-[var(--text-tertiary)]">Exposure</dt>
                      <dd className="m-0 mt-0.5">
                        <Amount
                          minor={account.open_exposure_minor}
                          currency={account.default_currency}
                          className="type-body-sm text-[var(--text-primary)]"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="type-caption text-[var(--text-tertiary)]">Synced</dt>
                      <dd className="m-0 mt-0.5 type-body-sm text-[var(--text-secondary)]">
                        {formatAge(account.synced_at)}
                      </dd>
                    </div>
                  </dl>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
