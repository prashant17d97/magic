'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseAsString, useQueryStates } from 'nuqs';
import type { SettlementListItem, SessionPayload } from '@magic/contracts';
import { DataTable, type Column } from '@/shared/components/data/DataTable';
import { CursorPager } from '@/shared/components/data/CursorPager';
import { DensityToggle } from '@/shared/components/data/DensityToggle';
import { FilterBar, FilterSelect, type AppliedFilter } from '@/shared/components/data/FilterBar';
import { EmptyState, ErrorState, TableSkeleton } from '@/shared/components/feedback/States';
import { Badge } from '@/shared/components/ui/Badge';
import { Amount } from '@/shared/components/money/Amount';
import { ObjectId } from '@/shared/components/money/ObjectId';
import { apiFetch, buildQuery } from '@/shared/lib/client';
import { formatAge } from '@/shared/lib/money';
import { SettlementDetailPanel } from './SettlementDetailPanel';

const STATUS_TONE = {
  settled: 'success',
  pending: 'info',
  partially_refunded: 'warning',
  refunded: 'muted',
  disputed: 'danger',
  reversed: 'warning',
} as const;

const TIER_TONE = { exact: 'success', strong: 'success', heuristic: 'warning', unmatched: 'danger' } as const;

/**
 * The charge-type-agnostic browse view.
 *
 * Charge type appears as a filter and a detail field and never structures the table. The whole
 * architecture below this screen exists to keep it out of the surfaces above the settlement
 * boundary, and putting it back in as a column here would quietly undo that.
 */
export function SettlementsTable({
  session,
  accounts,
}: {
  session: SessionPayload;
  accounts: { value: string; label: string }[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useQueryStates({
    q: parseAsString.withDefault(''),
    account_id: parseAsString.withDefault(''),
    charge_type: parseAsString.withDefault(''),
    status: parseAsString.withDefault(''),
    match_tier: parseAsString.withDefault(''),
    cursor: parseAsString,
  });

  const params = useMemo(
    () => ({
      q: filters.q,
      account_id: filters.account_id,
      charge_type: filters.charge_type,
      status: filters.status,
      match_tier: filters.match_tier,
      cursor: filters.cursor ?? undefined,
      limit: 50,
    }),
    [filters],
  );

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['settlements', params],
    queryFn: () => apiFetch<{ data: SettlementListItem[]; next_cursor: string | null }>(`/api/settlements${buildQuery(params)}`),
    placeholderData: (previous) => previous,
  });

  const applied: AppliedFilter[] = (
    [
      ['charge_type', 'charge type', filters.charge_type],
      ['status', 'status', filters.status],
      ['match_tier', 'match', filters.match_tier],
      ['account_id', 'account', filters.account_id],
    ] as const
  )
    .filter(([, , value]) => value)
    .map(([key, label, value]) => ({
      key,
      label,
      value,
      onRemove: () => void setFilters({ [key]: '', cursor: null }),
    }));

  const columns: Column<SettlementListItem>[] = [
    {
      id: 'charged_at',
      header: 'Charged',
      width: '78px',
      align: 'right',
      cell: (row) => <span className="text-[var(--text-secondary)]">{formatAge(row.charged_at)}</span>,
    },
    {
      id: 'merchant',
      header: 'Merchant',
      width: 'minmax(160px, 1fr)',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[var(--text-primary)]">
            {row.merchant_display_name ?? row.merchant_account_id}
          </p>
          <ObjectId id={row.charge_id} />
        </div>
      ),
    },
    {
      id: 'gross',
      header: 'Gross',
      width: '108px',
      align: 'right',
      cell: (row) => <Amount minor={row.customer_gross_minor} currency={row.currency} />,
    },
    {
      id: 'fee',
      header: 'Fee',
      width: '92px',
      align: 'right',
      priority: 2,
      cell: (row) => <Amount minor={row.processing_fee_minor} currency={row.currency} muted />,
    },
    {
      id: 'platform',
      header: 'Platform',
      width: '100px',
      align: 'right',
      cell: (row) => <Amount minor={row.platform_revenue_minor} currency={row.currency} />,
    },
    {
      id: 'net',
      header: 'Merchant net',
      width: '112px',
      align: 'right',
      cell: (row) => (
        <Amount minor={row.merchant_net_minor} currency={row.currency} className="font-medium" />
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: '132px',
      cell: (row) => (
        <Badge tone={STATUS_TONE[row.settlement_status]}>{row.settlement_status.replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      id: 'match',
      header: 'Match',
      width: '104px',
      priority: 2,
      cell: (row) =>
        row.match_tier ? <Badge tone={TIER_TONE[row.match_tier]}>{row.match_tier}</Badge> : <span>—</span>,
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3">
        <FilterBar
          search={filters.q}
          onSearchChange={(value) => void setFilters({ q: value, cursor: null })}
          searchPlaceholder="Search charge or payout id"
          applied={applied}
          onClearAll={() =>
            void setFilters({ q: '', account_id: '', charge_type: '', status: '', match_tier: '', cursor: null })
          }
          trailing={<DensityToggle />}
        >
          <FilterSelect
            label="Charge type"
            value={filters.charge_type}
            options={[
              { value: 'direct', label: 'Direct' },
              { value: 'destination', label: 'Destination' },
              { value: 'separate', label: 'Separate' },
              { value: 'unclassified', label: 'Unclassified' },
            ]}
            onChange={(value) => void setFilters({ charge_type: value, cursor: null })}
          />
          <FilterSelect
            label="Status"
            value={filters.status}
            options={[
              { value: 'settled', label: 'Settled' },
              { value: 'pending', label: 'Pending' },
              { value: 'partially_refunded', label: 'Partially refunded' },
              { value: 'refunded', label: 'Refunded' },
              { value: 'disputed', label: 'Disputed' },
            ]}
            onChange={(value) => void setFilters({ status: value, cursor: null })}
          />
          <FilterSelect
            label="Match"
            value={filters.match_tier}
            options={[
              { value: 'exact', label: 'Exact' },
              { value: 'strong', label: 'Strong' },
              { value: 'heuristic', label: 'Heuristic' },
              { value: 'unmatched', label: 'Unmatched' },
            ]}
            onChange={(value) => void setFilters({ match_tier: value, cursor: null })}
          />
          <FilterSelect
            label="Account"
            value={filters.account_id}
            options={accounts}
            onChange={(value) => void setFilters({ account_id: value, cursor: null })}
          />
        </FilterBar>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--bg-surface)]">
        {isLoading ? (
          <TableSkeleton rows={14} columns={8} />
        ) : error ? (
          <ErrorState body="Settlements could not be loaded. Your data is unaffected." />
        ) : (
          <DataTable
            caption="Normalised settlements across every Connect charge type"
            columns={columns}
            rows={data?.data ?? []}
            rowKey={(row) => row.charge_id}
            selectedId={selected}
            onRowClick={(row) => setSelected(row.charge_id)}
            emptyState={
              <EmptyState
                variant={applied.length > 0 || filters.q ? 'no-results' : 'not-started'}
                title={applied.length > 0 ? 'No settlements match these filters' : 'No settlements yet'}
                body={
                  applied.length > 0
                    ? 'Try clearing the charge type or match filter.'
                    : 'Settlements appear as charges are ingested and normalised.'
                }
              />
            }
          />
        )}
      </div>

      <CursorPager
        count={data?.data.length ?? 0}
        hasNext={Boolean(data?.next_cursor)}
        hasPrevious={Boolean(filters.cursor)}
        loading={isFetching}
        onNext={() => void setFilters({ cursor: data?.next_cursor ?? null })}
        onPrevious={() => void setFilters({ cursor: null })}
      />

      <SettlementDetailPanel
        chargeId={selected}
        onClose={() => setSelected(null)}
        timezone={session.tenant.timezone}
      />
    </div>
  );
}
