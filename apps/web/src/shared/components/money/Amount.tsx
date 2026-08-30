import { formatDelta, formatMinor } from '@/shared/lib/money';
import { cn } from '@/shared/lib/cn';

/**
 * Every money-bearing surface renders through here. Three rules hold everywhere:
 * amounts never round-trip through Number, the currency is always shown, and a delta carries an
 * explicit sign and a directional word rather than leaving colour to do the explaining.
 */
export function Amount({
  minor,
  currency,
  className,
  muted = false,
  strikethrough = false,
}: {
  minor: string | null | undefined;
  currency: string | null | undefined;
  className?: string;
  muted?: boolean;
  strikethrough?: boolean;
}) {
  return (
    <span
      className={cn(
        'numeric tabular-nums',
        muted && 'text-[var(--text-tertiary)]',
        strikethrough && 'line-through',
        className,
      )}
    >
      {formatMinor(minor, currency)}
    </span>
  );
}

export function AmountDelta({
  minor,
  currency,
  className,
  showLabel = true,
}: {
  minor: string | null | undefined;
  currency: string | null | undefined;
  className?: string;
  showLabel?: boolean;
}) {
  const { text, direction } = formatDelta(minor, currency);

  const tone =
    direction === 'balanced'
      ? 'text-[var(--success-fg)]'
      : direction === 'short'
        ? 'text-[var(--danger-fg)]'
        : 'text-[var(--warning-fg)]';

  const label = direction === 'balanced' ? 'balanced' : direction;

  return (
    <span className={cn('numeric tabular-nums font-medium', tone, className)}>
      {text}
      {showLabel ? <span className="ml-1.5 type-caption font-normal opacity-80">({label})</span> : null}
    </span>
  );
}
