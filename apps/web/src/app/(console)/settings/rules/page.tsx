import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readSession } from '@/shared/lib/session';
import { RulesSettings } from '@/features/rules';

export const metadata: Metadata = { title: 'Rules' };
export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const session = await readSession();
  if (!session) redirect('/sign-in');

  return (
    <div className="max-w-5xl">
      <p className="mb-4 max-w-3xl type-body-sm text-[var(--text-secondary)]">
        Rules are global and versioned like code. What is tunable per workspace is a rule&apos;s severity,
        its maturity window, and its parameters — a maturity window exists so money still legitimately
        in flight is not reported as missing.
      </p>
      <RulesSettings canEdit={session.permissions.includes('rule:write')} />
    </div>
  );
}
