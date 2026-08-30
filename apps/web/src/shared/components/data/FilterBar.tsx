'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons';
import { cn } from '@/shared/lib/cn';
import { Button } from '../ui/Button';

export interface AppliedFilter {
  key: string;
  label: string;
  value: string;
  onRemove(): void;
}

/**
 * Every filter writes to the URL, so the view is always shareable: an operator can paste a link
 * into a chat and a colleague opens the identical queue. Applied filters render as removable
 * chips, and "Clear all" appears only when at least one is set.
 */
export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search',
  applied,
  onClearAll,
  children,
  trailing,
}: {
  search: string;
  onSearchChange(value: string): void;
  searchPlaceholder?: string;
  applied: AppliedFilter[];
  onClearAll(): void;
  children?: ReactNode;
  trailing?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA'].includes(target.tagName);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[11px] text-[var(--text-tertiary)]"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className={cn(
              'h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)]',
              'pr-8 pl-7 type-body-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]',
              'focus:border-[var(--border-focus)] focus:outline-none',
            )}
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 type-mono-sm text-[var(--text-tertiary)]">
            /
          </kbd>
        </div>

        {children}
        <div className="ml-auto flex items-center gap-2">{trailing}</div>
      </div>

      {applied.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {applied.map((filter) => (
            <button
              key={`${filter.key}:${filter.value}`}
              type="button"
              onClick={filter.onRemove}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded-[var(--radius-xs)] border px-2',
                'border-[var(--border-default)] bg-[var(--bg-surface)] type-caption text-[var(--text-secondary)]',
                'hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
              )}
            >
              <span className="text-[var(--text-tertiary)]">{filter.label}</span>
              <span className="font-medium">{filter.value}</span>
              <FontAwesomeIcon icon={faXmark} className="text-[9px]" aria-hidden />
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={onClearAll}>
            Clear all
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange(value: string): void;
}) {
  return (
    <label className="inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)]',
          'px-2 type-body-sm text-[var(--text-primary)]',
          'focus:border-[var(--border-focus)] focus:outline-none',
        )}
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
