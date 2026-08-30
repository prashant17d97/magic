'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons';
import { cn } from '@/shared/lib/cn';

/**
 * Stripe identifiers are set in a monospace face that disambiguates 0/O and 1/l/I. That is not a
 * stylistic preference: operators copy `ch_3PxK2mLkdIwHu7ix1a2b3c4d` into other systems, and a
 * transcription error there costs an hour.
 */
export function ObjectId({
  id,
  truncate = true,
  className,
}: {
  id: string;
  truncate?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    } catch {
      setCopied(false);
    }
  }

  const display = truncate && id.length > 18 ? `${id.slice(0, 16)}…` : id;

  return (
    <button
      type="button"
      onClick={copy}
      title={`${id} — click to copy`}
      className={cn(
        'group inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-xs)] px-1 -mx-1',
        'type-mono text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
        'transition-colors duration-[var(--duration-instant)]',
        className,
      )}
    >
      <span className="truncate">{display}</span>
      <FontAwesomeIcon
        icon={copied ? faCheck : faCopy}
        className={cn(
          'text-[10px] shrink-0',
          copied ? 'text-[var(--success-fg)]' : 'text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100',
        )}
        aria-hidden
      />
      <span className="sr-only">{copied ? 'Copied' : 'Copy identifier'}</span>
    </button>
  );
}
