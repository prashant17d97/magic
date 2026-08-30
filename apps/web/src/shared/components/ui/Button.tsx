'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { cn } from '@/shared/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: IconDefinition;
  iconAfter?: IconDefinition;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--brand-fill)] text-[var(--brand-on-fill)] border border-transparent hover:bg-[var(--brand-fill-hover)] active:bg-[var(--brand-fill-active)]',
  secondary:
    'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]',
  ghost:
    'bg-transparent text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
  danger:
    'bg-transparent text-[var(--danger-fg)] border border-[var(--danger-border)] hover:bg-[var(--danger-bg)]',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[13px] gap-1.5',
  md: 'h-8 px-3 text-[13px] gap-2',
  lg: 'h-10 px-4 text-[14px] gap-2',
};

/**
 * The loading state keeps the label and locks the width. A button that collapses into a spinner
 * shifts the layout under the cursor that just clicked it, which is how a second click lands on
 * something else entirely.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, iconAfter, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-sm)] font-medium whitespace-nowrap',
        'transition-colors duration-[var(--duration-instant)] ease-[var(--ease-out)]',
        'active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <FontAwesomeIcon icon={faSpinner} className="animate-spin" aria-hidden />
      ) : icon ? (
        <FontAwesomeIcon icon={icon} aria-hidden />
      ) : null}
      {children}
      {iconAfter && !loading ? <FontAwesomeIcon icon={iconAfter} aria-hidden /> : null}
    </button>
  );
});
