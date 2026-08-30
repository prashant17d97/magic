'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { cn } from '@/shared/lib/cn';

/**
 * A right drawer that traps focus and returns it to the element that opened it.
 *
 * The list stays exactly where it was underneath. An operator working a queue must never lose
 * their position — it is the single biggest quality-of-life factor in queue work, and a modal
 * that resets scroll makes a fifty-row page feel twice as long.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'var(--drawer-width)',
}: {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      returnFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-[var(--scrim)] transition-opacity duration-[var(--duration-base)] xl:bg-transparent xl:pointer-events-none"
        style={{ zIndex: 'calc(var(--z-drawer) - 1)' }}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'fixed top-0 right-0 bottom-0 flex flex-col outline-none',
          'border-l border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-lg)]',
          'w-full max-w-full lg:w-[var(--drawer-width)]',
        )}
        style={{ zIndex: 'var(--z-drawer)', width }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <h2 className="type-h3 text-[var(--text-primary)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-mr-1 -mt-0.5 rounded-[var(--radius-sm)] p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <FontAwesomeIcon icon={faXmark} className="text-[14px]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">{children}</div>

        {footer ? (
          <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </>
  );
}
