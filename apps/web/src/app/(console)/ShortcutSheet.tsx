'use client';

import { Drawer } from '@/shared/components/data/Drawer';

const GROUPS: { title: string; shortcuts: { keys: string; action: string }[] }[] = [
  {
    title: 'Working the queue',
    shortcuts: [
      { keys: 'j / k', action: 'Next / previous row' },
      { keys: 'Enter or o', action: 'Open the detail panel' },
      { keys: 'Esc', action: 'Close the detail panel' },
      { keys: 'e', action: 'Resolve, with the note field focused' },
      { keys: 'i', action: 'Ignore, with the note field focused' },
      { keys: 'a', action: 'Assign' },
      { keys: 'x', action: 'Toggle row selection' },
    ],
  },
  {
    title: 'Moving around',
    shortcuts: [
      { keys: '/', action: 'Focus search' },
      { keys: '⌘K', action: 'Command palette' },
      { keys: 'g then h', action: 'Health' },
      { keys: 'g then e', action: 'Exceptions' },
      { keys: 'g then r', action: 'Runs' },
      { keys: '?', action: 'This reference' },
    ],
  },
];

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Drawer open={open} onClose={onClose} title="Keyboard shortcuts" width="420px">
      <div className="p-5">
        <p className="type-body-sm text-[var(--text-secondary)]">
          Every shortcut has a visible equivalent. These accelerate the work; nothing is hidden behind them.
        </p>

        {GROUPS.map((group) => (
          <section key={group.title} className="mt-6">
            <h3 className="type-label text-[var(--text-tertiary)]">{group.title}</h3>
            <dl className="mt-2.5 flex flex-col gap-1.5">
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.keys} className="flex items-baseline justify-between gap-4">
                  <dt className="type-body-sm text-[var(--text-primary)]">{shortcut.action}</dt>
                  <dd className="m-0">
                    <kbd className="rounded-[var(--radius-xs)] border border-[var(--border-default)] bg-[var(--bg-sunken)] px-1.5 py-0.5 type-mono-sm text-[var(--text-secondary)]">
                      {shortcut.keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Drawer>
  );
}
