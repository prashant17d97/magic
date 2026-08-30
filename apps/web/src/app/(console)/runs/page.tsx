import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { AccountListItem } from '@magic/contracts';
import { fetchFromApi } from '@/shared/lib/api-proxy';
import { readSession } from '@/shared/lib/session';
import { RunsTable } from '@/features/runs';
import { TopBar } from '../TopBar';

export const metadata: Metadata = { title: 'Runs' };
export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const session = await readSession();
  if (!session) redirect('/sign-in');

  let accounts: { value: string; label: string }[] = [];
  try {
    const response = await fetchFromApi<{ data: AccountListItem[] }>('/v1/accounts');
    accounts = response.data.map((account) => ({
      value: account.stripe_account_id,
      label: account.display_name ?? account.stripe_account_id,
    }));
  } catch {
    accounts = [];
  }

  return (
    <>
      <TopBar title="Reconciliation runs" description="Same inputs, same rule version, same result" />
      <RunsTable session={session} accounts={accounts} />
    </>
  );
}
