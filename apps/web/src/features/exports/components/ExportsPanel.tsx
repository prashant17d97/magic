'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload, faFileCsv } from '@fortawesome/free-solid-svg-icons';
import type { ExportRecord } from '@magic/contracts';
import { Badge } from '@/shared/components/ui/Badge';
import { Button } from '@/shared/components/ui/Button';
import { EmptyState } from '@/shared/components/feedback/States';
import { useToast } from '@/shared/components/feedback/Toast';
import { apiFetch } from '@/shared/lib/client';
import { formatAge, formatCount } from '@/shared/lib/money';

const STATUS_TONE = {
  ready: 'success',
  running: 'info',
  queued: 'muted',
  failed: 'danger',
  expired: 'muted',
} as const;

const KINDS = [
  { value: 'exceptions', label: 'Exceptions' },
  { value: 'settlements', label: 'Settlements' },
  { value: 'runs', label: 'Reconciliation runs' },
  { value: 'audit', label: 'Audit log' },
];

/**
 * Exports are always asynchronous and the link always expires.
 *
 * The scope is captured when the request is queued rather than when the file is fetched, so a
 * membership that widens in between cannot widen the file that was already authorised.
 */
export function ExportsPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState('exceptions');
  const [creating, setCreating] = useState(false);

  const { data } = useQuery({
    queryKey: ['exports'],
    queryFn: () => apiFetch<{ data: ExportRecord[] }>('/api/exports?limit=25'),
    refetchInterval: (query) =>
      (query.state.data as { data: ExportRecord[] } | undefined)?.data.some(
        (record) => record.status === 'queued' || record.status === 'running',
      )
        ? 3_000
        : false,
  });

  async function create(): Promise<void> {
    setCreating(true);
    try {
      await apiFetch('/api/exports', { method: 'POST', body: { kind, format: 'csv', filters: {} } });
      await queryClient.invalidateQueries({ queryKey: ['exports'] });
      toast.push({
        tone: 'success',
        message: 'Export queued',
        detail: 'The download link appears here when the file is ready.',
      });
    } catch (caught) {
      toast.push({
        tone: 'danger',
        message: 'The export was not queued',
        detail: caught instanceof Error ? caught.message : undefined,
      });
    } finally {
      setCreating(false);
    }
  }

  const records = data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <section className="surface p-4">
        <h2 className="type-h3 text-[var(--text-primary)]">New export</h2>
        <p className="mt-1 type-body-sm text-[var(--text-secondary)]">
          Generation runs in the background and streams straight to storage, so a large export never
          holds a request open. Links expire after fifteen minutes.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="export-kind">
            What to export
          </label>
          <select
            id="export-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 type-body-sm focus:border-[var(--border-focus)] focus:outline-none"
          >
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <Button variant="primary" icon={faFileCsv} loading={creating} onClick={() => void create()}>
            Generate CSV
          </Button>
        </div>
      </section>

      <section className="surface">
        <header className="border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 className="type-h3 text-[var(--text-primary)]">Recent exports</h2>
        </header>

        {records.length === 0 ? (
          <EmptyState variant="not-started" title="No exports yet" body="Generated files appear here." />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {records.map((record) => (
              <li key={record.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <FontAwesomeIcon icon={faFileCsv} className="text-[13px] text-[var(--text-tertiary)]" aria-hidden />

                <div className="min-w-0 flex-1">
                  <p className="type-body-sm text-[var(--text-primary)]">
                    {record.kind} · {record.format.toUpperCase()}
                  </p>
                  <p className="type-caption text-[var(--text-tertiary)]">
                    {record.requested_by_name ?? 'unknown'} · {formatAge(record.created_at)}
                    {record.row_count !== null ? ` · ${formatCount(record.row_count)} rows` : ''}
                  </p>
                </div>

                <Badge tone={STATUS_TONE[record.status]}>{record.status}</Badge>

                {record.download_url ? (
                  <a
                    href={record.download_url}
                    className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 type-body-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  >
                    <FontAwesomeIcon icon={faDownload} className="text-[11px]" aria-hidden />
                    Download
                  </a>
                ) : record.status === 'failed' ? (
                  <span className="type-caption text-[var(--danger-fg)]">{record.error ?? 'Generation failed'}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
