'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { SettlementDetail } from '@magic/contracts';
import { Drawer } from '@/shared/components/data/Drawer';
import { TableSkeleton } from '@/shared/components/feedback/States';
import { Badge } from '@/shared/components/ui/Badge';
import { SeverityIndicator } from '@/shared/components/ui/SeverityIndicator';
import { Amount } from '@/shared/components/money/Amount';
import { ObjectId } from '@/shared/components/money/ObjectId';
import { apiFetch } from '@/shared/lib/client';
import { formatTimestamp } from '@/shared/lib/money';

/**
 * The settlement panel shows the invariant every mapper must preserve:
 *
 *   customer gross = processing fee + platform revenue + merchant net + refunded
 *
 * Showing the arithmetic rather than four unrelated figures is what lets an operator confirm the
 * normalisation is right instead of trusting that it is.
 */
export function SettlementDetailPanel({
  chargeId,
  onClose,
  timezone,
}: {
  chargeId: string | null;
  onClose(): void;
  timezone: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['settlement', chargeId],
    queryFn: () => apiFetch<SettlementDetail>(`/api/settlements/${chargeId}`),
    enabled: chargeId !== null,
  });

  return (
    <Drawer open={chargeId !== null} onClose={onClose} title="Settlement">
      {isLoading || !data ? (
        <div className="p-5">
          <TableSkeleton rows={6} columns={3} />
        </div>
      ) : (
        <div className="flex flex-col gap-6 p-5">
          <section>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{data.charge_type}</Badge>
              <Badge tone="muted">{data.settlement_status.replace(/_/g, ' ')}</Badge>
              {data.match_tier ? <Badge tone="info">{data.match_tier} match</Badge> : null}
            </div>
            <div className="mt-2.5">
              <ObjectId id={data.charge_id} truncate={false} className="text-[var(--text-primary)]" />
            </div>
            <p className="mt-1 type-caption text-[var(--text-secondary)]">
              Charged {formatTimestamp(data.charged_at, timezone)} · settled on{' '}
              {data.funds_holder_account_id === data.merchant_account_id ? 'the merchant ledger' : 'the platform ledger'}
            </p>
          </section>

          <section className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] p-4">
            <h3 className="type-label text-[var(--text-tertiary)]">How the money divides</h3>
            <dl className="ledger-strip mt-3">
              <dt>Customer paid</dt>
              <dd>
                <Amount minor={data.customer_gross_minor} currency={data.currency} />
              </dd>

              <dt>Processing fee</dt>
              <dd>
                <Amount minor={`-${data.processing_fee_minor}`} currency={data.currency} muted />
              </dd>

              <dt>Platform revenue</dt>
              <dd>
                <Amount minor={`-${data.platform_revenue_minor}`} currency={data.currency} muted />
              </dd>

              {data.refunded_minor !== '0' ? (
                <>
                  <dt>Refunded</dt>
                  <dd>
                    <Amount minor={`-${data.refunded_minor}`} currency={data.currency} muted />
                  </dd>
                </>
              ) : null}

              <dt className="ledger-total">Merchant net</dt>
              <dd className="ledger-total text-[var(--text-primary)]">
                <Amount minor={data.merchant_net_minor} currency={data.currency} />
              </dd>
            </dl>
          </section>

          <section>
            <h3 className="type-label mb-2 text-[var(--text-tertiary)]">Postings</h3>
            <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
              {data.postings.map((posting, index) => (
                <li key={`${posting.kind}:${index}`} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="type-body-sm text-[var(--text-primary)]">{posting.kind.replace(/_/g, ' ')}</p>
                    <p className="truncate type-mono-sm text-[var(--text-tertiary)]">{posting.account_id}</p>
                  </div>
                  <Amount minor={posting.amount_minor} currency={posting.currency} className="type-table" />
                </li>
              ))}
            </ul>
          </section>

          {data.charge_type_signals ? (
            <section>
              <h3 className="type-label mb-2 text-[var(--text-tertiary)]">
                Classification · confidence {data.charge_type_confidence ?? '—'}
              </h3>
              <pre className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-2.5 type-mono text-[var(--text-secondary)]">
                {JSON.stringify(data.charge_type_signals, null, 2)}
              </pre>
            </section>
          ) : null}

          <section>
            <h3 className="type-label mb-2 text-[var(--text-tertiary)]">Linked objects</h3>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {data.linked_objects.map((object) => (
                <li key={object.id} className="flex items-center gap-1.5">
                  <span className="type-caption text-[var(--text-tertiary)]">{object.label}</span>
                  <ObjectId id={object.id} />
                </li>
              ))}
            </ul>
          </section>

          {data.open_exceptions.length > 0 ? (
            <section>
              <h3 className="type-label mb-2 text-[var(--text-tertiary)]">Open findings on this charge</h3>
              <ul className="flex flex-col gap-1.5">
                {data.open_exceptions.map((exception) => (
                  <li key={exception.id}>
                    <Link
                      href={`/exceptions/${exception.id}`}
                      className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2.5 hover:bg-[var(--bg-hover)]"
                    >
                      <SeverityIndicator severity={exception.severity} showLabel={false} className="mt-0.5" />
                      <span className="type-body-sm text-[var(--text-primary)]">{exception.narrative}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
