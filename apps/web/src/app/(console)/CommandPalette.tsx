'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRightArrowLeft,
  faBuildingColumns,
  faCircleHalfStroke,
  faClipboardList,
  faDownload,
  faGauge,
  faGear,
  faRotate,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { cn } from '@/shared/lib/cn';
import { useConsoleStore } from '@/shared/hooks/useConsoleStore';

interface Command {
  id: string;
  label: string;
  hint: string;
  icon: IconDefinition;
  run(): void;
}

/**
 * Every shortcut has a visible equivalent somewhere in the interface. Shortcuts accelerate an
 * operator who lives here; they never gate an action behind knowing them.
 */
export function CommandPalette() {
  const router = useRouter();
  const open = useConsoleStore((state) => state.commandPaletteOpen);
  const setOpen = useConsoleStore((state) => state.setCommandPaletteOpen);
  const setTheme = useConsoleStore((state) => state.setTheme);
  const theme = useConsoleStore((state) => state.theme);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const commands = useMemo<Command[]>(
    () => [
      { id: 'health', label: 'Go to Health', hint: 'g then h', icon: faGauge, run: () => router.push('/') },
      { id: 'exceptions', label: 'Go to Exceptions', hint: 'g then e', icon: faTriangleExclamation, run: () => router.push('/exceptions') },
      { id: 'runs', label: 'Go to Runs', hint: 'g then r', icon: faRotate, run: () => router.push('/runs') },
      { id: 'settlements', label: 'Go to Settlements', hint: '', icon: faArrowRightArrowLeft, run: () => router.push('/settlements') },
      { id: 'accounts', label: 'Go to Accounts', hint: '', icon: faBuildingColumns, run: () => router.push('/accounts') },
      { id: 'exports', label: 'Go to Exports', hint: '', icon: faDownload, run: () => router.push('/exports') },
      { id: 'audit', label: 'Go to Audit log', hint: '', icon: faClipboardList, run: () => router.push('/audit') },
      { id: 'rules', label: 'Go to Rule settings', hint: '', icon: faGear, run: () => router.push('/settings/rules') },
      {
        id: 'critical',
        label: 'Show open critical exceptions',
        hint: '',
        icon: faTriangleExclamation,
        run: () => router.push('/exceptions?status=open&severity=critical'),
      },
      {
        id: 'theme',
        label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
        hint: '',
        icon: faCircleHalfStroke,
        run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
    ],
    [router, setTheme, theme],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return commands;
    return commands.filter((command) => command.label.toLowerCase().includes(term));
  }, [commands, query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!open);
        setQuery('');
        setActive(0);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center bg-[var(--scrim)] pt-[12vh]"
      style={{ zIndex: 'var(--z-modal)' }}
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-lg)]"
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, filtered.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              filtered[active]?.run();
              setOpen(false);
            }
          }}
          placeholder="Search commands"
          aria-label="Search commands"
          className="w-full border-b border-[var(--border-subtle)] bg-transparent px-4 py-3 type-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
        />

        <ul className="max-h-80 overflow-y-auto p-1.5" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center type-body-sm text-[var(--text-tertiary)]">No matching command</li>
          ) : (
            filtered.map((command, index) => (
              <li key={command.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    command.run();
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-left type-body-sm',
                    index === active ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
                  )}
                >
                  <FontAwesomeIcon icon={command.icon} className="w-4 text-[12px] text-[var(--text-tertiary)]" aria-hidden />
                  <span className="flex-1">{command.label}</span>
                  {command.hint ? (
                    <kbd className="type-mono-sm text-[var(--text-tertiary)]">{command.hint}</kbd>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
