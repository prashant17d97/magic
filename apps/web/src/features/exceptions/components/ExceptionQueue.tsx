'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ExceptionListItem, SessionPayload } from '@magic/contracts';
import { DataTable, type Column } from '@/shared/components/data/DataTable';
import { CursorPager } from '@/shared/components/data/CursorPager';
import { DensityToggle } from '@/shared/components/data/DensityToggle';
import { FilterBar, FilterSelect, type AppliedFilter } from '@/shared/components/data/FilterBar';
import { EmptyState, ErrorState, TableSkeleton } from '@/shared/components/feedback/States';
import { Button } from '@/shared/components/ui/Button';
import { SeverityIndicator } from '@/shared/components/ui/SeverityIndicator';
import { StatusChip } from '@/shared/components/ui/StatusChip';
import { Amount } from '@/shared/components/money/Amount';
import { ObjectId } from '@/shared/components/money/ObjectId';
import { useToast } from '@/shared/components/feedback/Toast';
import { useConsoleStore } from '@/shared/hooks/useConsoleStore';
import { apiFetch } from '@/shared/lib/client';
import { formatAge, formatTimestamp } from '@/shared/lib/money';
import { ExceptionDetailPanel } from './ExceptionDetailPanel';
import { SavedViews } from './SavedViews';
import {
  useCursorHistory,
  useExceptionFilters,
  useExceptions,
  useInvalidateExceptions,
} from '../hooks/useExceptionQueue';
import { useQueueKeyboard } from '../hooks/useQueueKeyboard';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'ignored', label: 'Ignored' },
];

const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export function ExceptionQueue({
  session,
  accounts,
  initialSelectedId,
}: {
  session: SessionPayload;
  accounts: { value: string; label: string }[];
  initialSelectedId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateExceptions();
  const { filters, setFilters, cursor, setCursor, clearAll } = useExceptionFilters();
  const history = useCursorHistory(cursor);

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [requestedAction, setRequestedAction] = useState<'resolve' | 'ignore' | 'assign' | null>(null);
  const [bulkNote, setBulkNote] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);

  const selection = useConsoleStore((state) => state.selection);
  const toggleSelected = useConsoleStore((state) => state.toggleSelected);
  const setSelection = useConsoleStore((state) => state.setSelection);
  const clearSelection = useConsoleStore((state) => state.clearSelection);

  const params = useMemo(
    () => ({
      status: filters.status,
      severity: filters.severity,
      rule_id: filters.rule_id,
      account_id: filters.account_id,
      assignee_id: filters.assignee_id,
      q: filters.q,
      sort: filters.sort,
      direction: filters.direction,
      cursor: cursor ?? undefined,
      limit: 50,
    }),
    [filters, cursor],
  );

  const { data, isLoading, isFetching, error, refetch } = useExceptions(params);
  const rows = data?.data ?? [];
  const canTransition = session.permissions.includes('exception:transition');

  const openRow = useCallback(
    (row: ExceptionListItem) => {
      setSelectedId(row.id);
      window.history.replaceState(null, '', `/exceptions/${row.id}${window.location.search}`);
    },
    [],
  );

  const closePanel = useCallback(() => {
    setSelectedId(null);
    window.history.replaceState(null, '', `/exceptions${window.location.search}`);
  }, []);

  useQueueKeyboard({
    enabled: true,
    onNext: () => setFocusedIndex((index) => Math.min(index + 1, rows.length - 1)),
    onPrevious: () => setFocusedIndex((index) => Math.max(index - 1, 0)),
    onOpen: () => {
      const row = rows[focusedIndex];
      if (row) openRow(row);
    },
    onClose: closePanel,
    onResolve: () => {
      const row = rows[focusedIndex];
      if (!canTransition || !row) return;
      setSelectedId(row.id);
      setRequestedAction('resolve');
    },
    onIgnore: () => {
      const row = rows[focusedIndex];
      if (!canTransition || !row) return;
      setSelectedId(row.id);
      setRequestedAction('ignore');
    },
    onAssign: () => {
      const row = rows[focusedIndex];
      if (!canTransition || !row) return;
      setSelectedId(row.id);
      setRequestedAction('assign');
    },
    onToggleSelect: () => {
      const row = rows[focusedIndex];
      if (row) toggleSelected(row.id);
    },
  });

  const applied: AppliedFilter[] = [
    ...filters.status.map((value) => ({
      key: 'status',
      label: 'status',
      value,
      onRemove: () => void setFilters({ status: filters.status.filter((s) => s !== value) }),
    })),
    ...filters.severity.map((value) => ({
      key: 'severity',
      label: 'severity',
      value,
      onRemove: () => void setFilters({ severity: filters.severity.filter((s) => s !== value) }),
    })),
    ...(filters.account_id
      ? [
          {
            key: 'account',
            label: 'account',
            value: accounts.find((a) => a.value === filters.account_id)?.label ?? filters.account_id,
            onRemove: () => void setFilters({ account_id: '' }),
          },
        ]
      : []),
    ...(filters.rule_id
      ? [{ key: 'rule', label: 'rule', value: filters.rule_id, onRemove: () => void setFilters({ rule_id: '' }) }]
      : []),
  ];

  const columns: Column<ExceptionListItem>[] = [
    {
      id: 'severity',
      header: 'Severity',
      width: '116px',
      cell: (row) => <SeverityIndicator severity={row.severity} />,
    },
    {
      id: 'rule',
      header: 'Rule',
      width: 'minmax(200px, 1fr)',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[var(--text-primary)]">{row.rule_name}</p>
          <p className="truncate type-mono-sm text-[var(--text-tertiary)]">{row.rule_id}</p>
        </div>
      ),
    },
    {
      id: 'account',
      header: 'Account',
      width: '160px',
      priority: 2,
      cell: (row) => (
        <span className="truncate text-[var(--text-secondary)]">{row.account_display_name ?? row.stripe_account_id}</span>
      ),
    },
    {
      id: 'subject',
      header: 'Subject',
      width: '150px',
      priority: 3,
      cell: (row) => <ObjectId id={row.subject_id} />,
    },
    {
      id: 'exposure',
      header: 'Exposure',
      width: '120px',
      align: 'right',
      sortable: true,
      cell: (row) => (
        <Amount
          minor={row.exposure_minor}
          currency={row.currency}
          muted={row.status === 'resolved' || row.status === 'ignored'}
          strikethrough={row.status === 'resolved'}
          className="font-medium"
        />
      ),
    },
    {
      id: 'age',
      header: 'Age',
      width: '64px',
      align: 'right',
      sortable: true,
      priority: 2,
      cell: (row) => (
        <span title={formatTimestamp(row.last_seen_at, session.tenant.timezone)} className="text-[var(--text-secondary)]">
          {formatAge(row.last_seen_at)}
        </span>
      ),
    },
    {
      id: 'assignee',
      header: 'Assignee',
      width: '110px',
      priority: 3,
      cell: (row) => (
        <span className="truncate text-[var(--text-secondary)]">{row.assignee_name ?? '—'}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: '128px',
      cell: (row) => <StatusChip status={row.status} />,
    },
  ];

  async function bulkIgnore(): Promise<void> {
    try {
      const result = await apiFetch<{ updated: number }>('/api/exceptions/bulk/ignore', {
        method: 'POST',
        body: { ids: [...selection], note: bulkNote },
      });
      invalidate();
      clearSelection();
      setBulkOpen(false);
      setBulkNote('');
      toast.push({ tone: 'success', message: `${result.updated} exception(s) ignored` });
    } catch (caught) {
      toast.push({
        tone: 'danger',
        message: 'Nothing was changed',
        detail: caught instanceof Error ? caught.message : 'The server rejected the request.',
      });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3">
        <FilterBar
          search={filters.q}
          onSearchChange={(value) => {
            void setFilters({ q: value });
            void setCursor(null);
          }}
          searchPlaceholder="Search rule, subject or narrative"
          applied={applied}
          onClearAll={clearAll}
          trailing={
            <>
              <SavedViews resource="exceptions" />
              <DensityToggle />
            </>
          }
        >
          <FilterSelect
            label="Status"
            value={filters.status[0] ?? ''}
            options={STATUS_OPTIONS}
            onChange={(value) => {
              void setFilters({ status: value ? [value] : [] });
              void setCursor(null);
            }}
          />
          <FilterSelect
            label="Severity"
            value={filters.severity[0] ?? ''}
            options={SEVERITY_OPTIONS}
            onChange={(value) => {
              void setFilters({ severity: value ? [value] : [] });
              void setCursor(null);
            }}
          />
          <FilterSelect
            label="Account"
            value={filters.account_id}
            options={accounts}
            onChange={(value) => {
              void setFilters({ account_id: value });
              void setCursor(null);
            }}
          />
        </FilterBar>
      </div>

      {selection.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-selected)] px-5 py-2.5">
          <p className="type-body-sm font-medium text-[var(--text-primary)]">
            {selection.size} selected
          </p>
          <Button size="sm" onClick={() => setBulkOpen((value) => !value)} disabled={!canTransition}>
            Ignore selected
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            Clear selection
          </Button>
          <p className="ml-auto type-caption text-[var(--text-tertiary)]">
            Bulk resolve is deliberately not offered — each finding is verified individually.
          </p>
        </div>
      ) : null}

      {bulkOpen ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3">
          <label htmlFor="bulk-note" className="type-body-sm text-[var(--text-secondary)]">
            Reason
          </label>
          <input
            id="bulk-note"
            value={bulkNote}
            onChange={(event) => setBulkNote(event.target.value)}
            className="h-8 min-w-[280px] flex-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 type-body-sm focus:border-[var(--border-focus)] focus:outline-none"
            placeholder="Why are these not real issues?"
          />
          <Button variant="primary" size="sm" disabled={bulkNote.trim().length < 3} onClick={() => void bulkIgnore()}>
            Confirm
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setBulkOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--bg-surface)]">
        {isLoading ? (
          <TableSkeleton rows={14} columns={7} />
        ) : error ? (
          <ErrorState
            body="The exception queue could not be loaded. Your data is unaffected."
            action={<Button onClick={() => void refetch()}>Retry</Button>}
          />
        ) : (
          <DataTable
            caption="Open reconciliation exceptions"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            selectedId={selectedId}
            focusedIndex={focusedIndex}
            selection={selection}
            onToggleSelect={toggleSelected}
            onToggleSelectAll={() =>
              selection.size === rows.length ? clearSelection() : setSelection(rows.map((r) => r.id))
            }
            onRowClick={(row, index) => {
              setFocusedIndex(index);
              openRow(row);
            }}
            sort={{ column: filters.sort, direction: filters.direction as 'asc' | 'desc' }}
            onSortChange={(column) => {
              const nextDirection = filters.sort === column && filters.direction === 'desc' ? 'asc' : 'desc';
              void setFilters({ sort: column, direction: nextDirection });
              void setCursor(null);
            }}
            emptyState={
              applied.length > 0 || filters.q ? (
                <EmptyState
                  variant="no-results"
                  title="No exceptions match these filters"
                  body="Try widening the date range or clearing the severity filter."
                  action={<Button onClick={clearAll}>Clear filters</Button>}
                />
              ) : (
                <EmptyState
                  variant="all-clear"
                  title="No open exceptions"
                  body="Every payout in range reconciles against its balance transactions."
                  verifiedAt={formatTimestamp(new Date().toISOString(), session.tenant.timezone)}
                  action={<Button onClick={() => router.push('/runs')}>View reconciliation runs</Button>}
                />
              )
            }
          />
        )}
      </div>

      <CursorPager
        count={rows.length}
        hasNext={Boolean(data?.next_cursor)}
        hasPrevious={history.hasPrevious}
        loading={isFetching}
        onNext={() => {
          if (!data?.next_cursor) return;
          history.push(data.next_cursor);
          void setCursor(data.next_cursor);
          setFocusedIndex(0);
        }}
        onPrevious={() => {
          const previous = history.pop();
          void setCursor(previous);
          setFocusedIndex(0);
        }}
      />

      <ExceptionDetailPanel
        exceptionId={selectedId}
        onClose={closePanel}
        canTransition={canTransition}
        timezone={session.tenant.timezone}
        requestedAction={requestedAction}
        onActionHandled={() => setRequestedAction(null)}
      />
    </div>
  );
}
