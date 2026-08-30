import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck, faCircleExclamation, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import Link from 'next/link';
import type { HealthSummary } from '@magic/contracts';
import { cn } from '@/shared/lib/cn';
import { formatAge, formatCount } from '@/shared/lib/money';

type Status = 'healthy' | 'warning' | 'critical';

function StatusLine({ status, children }: { status: Status; children: React.ReactNode }) {
  const icon = status === 'healthy' ? faCircleCheck : status === 'warning' ? faTriangleExclamation : faCircleExclamation;
  const tone =
    status === 'healthy'
      ? 'text-[var(--success-fg)]'
      : status === 'warning'
        ? 'text-[var(--warning-fg)]'
        : 'text-[var(--danger-fg)]';

  return (
    <p className={cn('mt-2 flex items-center gap-1.5 type-caption', tone)}>
      <FontAwesomeIcon icon={icon} className="text-[10px]" aria-hidden />
      {children}
    </p>
  );
}

function Tile({
  label,
  value,
  sub,
  status,
  statusText,
  href,
}: {
  label: string;
  value: string;
  sub: string;
  status: Status;
  statusText: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'surface flex flex-col justify-between p-4',
        'transition-colors duration-[var(--duration-instant)] hover:border-[var(--border-default)]',
      )}
    >
      <p className="type-label text-[var(--text-tertiary)]">{label}</p>
      <p className="type-kpi mt-2 text-[var(--text-primary)]">{value}</p>
      <p className="mt-0.5 type-caption text-[var(--text-secondary)]">{sub}</p>
      <StatusLine status={status}>{statusText}</StatusLine>
    </Link>
  );
}

/**
 * The trust row. Completeness leads because it is the one number that decides whether anything
 * else on this page can be believed, and any non-zero drift is a page — so it is stated as a
 * count of missing objects rather than buried in a percentage.
 */
export function HealthTiles({ summary }: { summary: HealthSummary }) {
  const driftStatus: Status = summary.completeness.total_drift === 0 ? 'healthy' : 'critical';
  const lagStatus: Status =
    summary.ingestion.lag_p95_seconds > 300 ? 'critical' : summary.ingestion.lag_p95_seconds > 60 ? 'warning' : 'healthy';
  const queueStatus: Status =
    summary.queues.dlq_depth > 0 ? 'critical' : summary.queues.total_depth > 500 ? 'warning' : 'healthy';
  const runStatus: Status = summary.last_run?.status === 'completed' ? 'healthy' : summary.last_run ? 'warning' : 'warning';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label="Completeness"
        value={`${summary.completeness.percent}%`}
        sub={`${formatCount(summary.completeness.accounts_checked)} account${summary.completeness.accounts_checked === 1 ? '' : 's'} checked`}
        status={driftStatus}
        statusText={
          summary.completeness.total_drift === 0
            ? 'Zero drift — every object accounted for'
            : `${formatCount(summary.completeness.total_drift)} object(s) missing locally`
        }
        href="/accounts"
      />

      <Tile
        label="Ingestion lag"
        value={`${Math.round(summary.ingestion.lag_p95_seconds)}s`}
        sub={`p95 · ${formatCount(summary.ingestion.events_last_hour)} events in the last hour`}
        status={lagStatus}
        statusText={
          lagStatus === 'healthy' ? 'Within the 60 second target' : `${formatCount(summary.ingestion.pending_events)} events still pending`
        }
        href="/audit"
      />

      <Tile
        label="Queue depth"
        value={formatCount(summary.queues.total_depth)}
        sub="Unpublished outbox jobs"
        status={queueStatus}
        statusText={
          summary.queues.dlq_depth > 0
            ? `${formatCount(summary.queues.dlq_depth)} job(s) dead-lettered`
            : 'Nothing dead-lettered'
        }
        href="/settings/operations"
      />

      <Tile
        label="Last run"
        value={summary.last_run ? formatAge(summary.last_run.finished_at) : '—'}
        sub={
          summary.last_run
            ? `${formatCount(summary.last_run.objects_evaluated)} objects evaluated`
            : 'No reconciliation has run yet'
        }
        status={runStatus}
        statusText={summary.last_run?.status === 'completed' ? 'Completed cleanly' : 'Check the run history'}
        href="/runs"
      />
    </div>
  );
}
