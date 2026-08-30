'use client';

import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { Button } from '../ui/Button';

/**
 * Cursor pagination, exposed as it actually behaves.
 *
 * There is no page count and no jump-to-page, because there is no OFFSET anywhere in this system:
 * at page four thousand that would be a scan of rows nobody will ever see. Showing a page number
 * we cannot honour would be a worse lie than showing none.
 */
export function CursorPager({
  count,
  hasNext,
  hasPrevious,
  onNext,
  onPrevious,
  loading = false,
}: {
  count: number;
  hasNext: boolean;
  hasPrevious: boolean;
  onNext(): void;
  onPrevious(): void;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] px-4 py-2.5">
      <p className="type-caption text-[var(--text-secondary)]" aria-live="polite">
        {count === 0 ? 'No rows' : `${count} row${count === 1 ? '' : 's'} on this page`}
      </p>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onPrevious} disabled={!hasPrevious || loading} icon={faChevronLeft}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" onClick={onNext} disabled={!hasNext || loading} iconAfter={faChevronRight}>
          Next
        </Button>
      </div>
    </div>
  );
}
