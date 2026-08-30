import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleCheck,
  faFilterCircleXmark,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Three states that are never conflated.
 *
 * The all-clear case is the one worth designing carefully. In most products an empty table is a
 * failure; here it is the good outcome, and it should read as reassurance rather than absence —
 * which is only credible with a timestamp attached to it.
 */
export function EmptyState({
  variant,
  title,
  body,
  action,
  verifiedAt,
}: {
  variant: 'all-clear' | 'no-results' | 'not-started';
  title: string;
  body: string;
  action?: ReactNode;
  verifiedAt?: string;
}) {
  const icon =
    variant === 'all-clear' ? faCircleCheck : variant === 'no-results' ? faFilterCircleXmark : faCircleCheck;

  const tone = variant === 'all-clear' ? 'text-[var(--success-fg)]' : 'text-[var(--text-tertiary)]';

  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <FontAwesomeIcon icon={icon} className={cn('mb-4 text-[28px]', tone)} aria-hidden />
      <h2 className="type-h3 text-[var(--text-primary)]">{title}</h2>
      <p className="mt-1.5 max-w-md type-body-sm text-[var(--text-secondary)]">{body}</p>
      {verifiedAt ? (
        <p className="mt-3 type-caption text-[var(--text-tertiary)]">Last verified {verifiedAt}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/**
 * Error states say what is unaffected and carry a copyable trace id. It costs nothing and turns
 * a support ticket from "it broke" into a single query.
 */
export function ErrorState({
  title = "Couldn't load this view",
  body = 'The request failed. Your data is unaffected.',
  traceId,
  action,
}: {
  title?: string;
  body?: string;
  traceId?: string | null;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
    >
      <FontAwesomeIcon
        icon={faTriangleExclamation}
        className="mb-4 text-[28px] text-[var(--danger-fg)]"
        aria-hidden
      />
      <h2 className="type-h3 text-[var(--text-primary)]">{title}</h2>
      <p className="mt-1.5 max-w-md type-body-sm text-[var(--text-secondary)]">{body}</p>
      {traceId ? (
        <p className="mt-3 type-mono text-[var(--text-tertiary)]">
          trace {traceId}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Skeleton rows match the final row height exactly, so applying data shifts nothing. */
export function TableSkeleton({ rows = 12, columns = 8 }: { rows?: number; columns?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading rows">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex items-center gap-4 border-b border-[var(--border-subtle)] px-4"
          style={{ height: 'var(--row-height)' }}
        >
          {Array.from({ length: columns }, (_, columnIndex) => (
            <div
              key={columnIndex}
              className="skeleton h-3"
              style={{ width: `${[64, 96, 120, 88, 72, 56, 64, 80][columnIndex % 8]}px` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
