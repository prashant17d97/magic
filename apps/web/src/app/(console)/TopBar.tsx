'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleHalfStroke, faKeyboard, faTerminal } from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { useConsoleStore } from '@/shared/hooks/useConsoleStore';
import { ShortcutSheet } from './ShortcutSheet';

export function TopBar({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const setCommandPaletteOpen = useConsoleStore((state) => state.setCommandPaletteOpen);
  const theme = useConsoleStore((state) => state.theme);
  const setTheme = useConsoleStore((state) => state.setTheme);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  return (
    <header className="flex min-h-14 shrink-0 items-center gap-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5">
      <div className="min-w-0 flex-1">
        <h1 className="type-h1 truncate text-[var(--text-primary)]">{title}</h1>
        {description ? (
          <p className="mt-0.5 truncate type-caption text-[var(--text-secondary)]">{description}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {actions}

        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)]',
            'bg-[var(--bg-surface)] px-2.5 type-caption text-[var(--text-secondary)] hover:border-[var(--border-strong)]',
          )}
        >
          <FontAwesomeIcon icon={faTerminal} className="text-[11px]" aria-hidden />
          <kbd className="type-mono-sm">⌘K</kbd>
          <span className="sr-only">Open command palette</span>
        </button>

        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          title="Keyboard shortcuts"
          className="inline-flex size-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <FontAwesomeIcon icon={faKeyboard} className="text-[13px]" aria-hidden />
          <span className="sr-only">Keyboard shortcuts</span>
        </button>

        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
          title={`Theme: ${theme}`}
          className="inline-flex size-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <FontAwesomeIcon icon={faCircleHalfStroke} className="text-[13px]" aria-hidden />
          <span className="sr-only">{`Theme: ${theme}. Click to change.`}</span>
        </button>
      </div>

      <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </header>
  );
}
