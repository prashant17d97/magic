import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'brand';

const TONES: Record<BadgeTone, string> = {
  success: 'text-[var(--success-fg)] bg-[var(--success-bg)] border-[var(--success-border)]',
  warning: 'text-[var(--warning-fg)] bg-[var(--warning-bg)] border-[var(--warning-border)]',
  danger: 'text-[var(--danger-fg)] bg-[var(--danger-bg)] border-[var(--danger-border)]',
  info: 'text-[var(--info-fg)] bg-[var(--info-bg)] border-[var(--info-border)]',
  muted: 'text-[var(--muted-fg)] bg-[var(--muted-bg)] border-[var(--muted-border)]',
  brand: 'text-[var(--brand-tone-fg)] bg-[var(--brand-tone-bg)] border-[var(--brand-tone-border)]',
};

/**
 * Colour is never the only signal. Every badge composes an icon with a label, which is an
 * accessibility requirement and a comprehension one: operators scan words faster than hues.
 */
export function Badge({
  tone = 'muted',
  icon,
  children,
  className,
}: {
  tone?: BadgeTone;
  icon?: IconDefinition;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-[var(--radius-xs)] border px-1.5',
        'type-label',
        TONES[tone],
        className,
      )}
    >
      {icon ? <FontAwesomeIcon icon={icon} className="text-[10px]" aria-hidden /> : null}
      {children}
    </span>
  );
}
