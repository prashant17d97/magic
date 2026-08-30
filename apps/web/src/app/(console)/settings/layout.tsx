import Link from 'next/link';
import { redirect } from 'next/navigation';
import { readSession } from '@/shared/lib/session';
import { TopBar } from '../TopBar';

const TABS = [
  { href: '/settings/rules', label: 'Rules' },
  { href: '/settings/members', label: 'Members' },
  { href: '/settings/operations', label: 'Operations' },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session) redirect('/sign-in');

  return (
    <>
      <TopBar title="Settings" description={`${session.tenant.display_name} · signed in as ${session.role}`} />

      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5">
        <nav aria-label="Settings sections" className="flex gap-1">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="border-b-2 border-transparent px-3 py-2.5 type-body-sm text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
    </>
  );
}
