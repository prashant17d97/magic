'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { RunListItem, SessionPayload } from '@magic/contracts';
import { DataTable, type Column } from '@/shared/components/data/DataTable';
import { DensityToggle } from '@/shared/components/data/DensityToggle';
import { EmptyState, ErrorState, TableSkeleton } from '@/shared/components/feedback/States';
import { Badge } from '@/shared/components/ui/Badge';
import { AmountDelta } from '@/shared/components/money/Amount';
import { ObjectId } from '@/shared/components/money/ObjectId';
import { apiFetch } from '@/shared/lib/client';
import { formatAge, formatCount } from '@/shared/lib/money';
import { TriggerRunButton } from './TriggerRunButton';

const STATUS_TONE = {
  completed: 'success',
  running: 'info',
  queued: 'muted',
  failed: 'danger',
  superseded: 'muted',
} as const;

export function RunsTable({
  session,
  accounts,
}: {
  session: SessionPayload;
  accounts: { value: string; label: string }[];
}) {
  const router = useRouter();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['runs'],
    queryFn: () => apiFetch<{ data: RunListItem[]; next_cursor: string | null }>('/api/runs?limit=50'),
  });

  const columns: Column<RunListItem>[] = [
    {
      id: 'scope',
      header: 'Scope',
      width: 'minmax(200px, 1fr)',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[var(--text-primary)]">
            {row.account_display_name ?? row.stripe_account_id}
          </p>
          <p className="truncate type-mono-sm text-[var(--text-tertiary)]">
            {row.payout_id ?? `${row.scope_type} scope`}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: '110px',
      cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
    },
    {
      id: 'delta',
      header: 'Checksum Δ',
      width: '150px',
      align: 'right',
      cell: (row) => <AmountDelta minor={row.checksum_delta_minor} currency={row.currency} showLabel={false} />,
    },
    {
      id: 'objects',
      header: 'Objects',
      width: '90px',
      align: 'right',
      priority: 2,
      cell: (row) => <span className="text-[var(--text-secondary)]">{formatCount(row.objects_evaluated)}</span>,
    },
    {
      id: 'raised',
      header: 'Raised',
      width: '80px',
      align: 'right',
      cell: (row) => (
        <span className={row.exceptions_opened > 0 ? 'text-[var(--danger-fg)]' : 'text-[var(--text-secondary)]'}>
          {formatCount(row.exceptions_opened)}
        </span>
      ),
    },
    {
      id: 'closed',
      header: 'Closed',
      width: '80px',
      align: 'right',
      priority: 3,
      cell: (row) => <span className="text-[var(--text-secondary)]">{formatCount(row.exceptions_closed)}</span>,
    },
    {
      id: 'checksum',
      header: 'Snapshot',
      width: '140px',
      priority: 3,
      cell: (row) => (row.snapshot_checksum ? <ObjectId id={row.snapshot_checksum} /> : <span>—</span>),
    },
    {
      id: 'finished',
      header: 'Finished',
      width: '80px',
      align: 'right',
      cell: (row) => <span className="text-[var(--text-secondary)]">{formatAge(row.finished_at)}</span>,
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3">
        <p className="type-body-sm text-[var(--text-secondary)]">
          A run is scoped to one payout or one account window and is reproducible from its snapshot checksum.
        </p>
        <div className="ml-auto flex items-center gap-2">
          {session.permissions.includes('run:trigger') ? (
            <TriggerRunButton accounts={accounts} onDone={() => void refetch()} />
          ) : null}
          <DensityToggle />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--bg-surface)]">
        {isLoading ? (
          <TableSkeleton rows={12} columns={7} />
        ) : error ? (
          <ErrorState body="The run history could not be loaded. Your data is unaffected." />
        ) : (
          <DataTable
            caption="Reconciliation run history"
            columns={columns}
            rows={data?.data ?? []}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/runs/${row.id}`)}
            emptyState={
              <EmptyState
                variant="not-started"
                title="No runs yet"
                body="Reconciliation runs when a payout settles, on a schedule, or when you trigger one."
              />
            }
          />
        )}
      </div>
    </div>
  );
}
