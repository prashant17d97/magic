import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { AccountListItem } from '@magic/contracts';
import { fetchFromApi } from '@/shared/lib/api-proxy';
import { readSession } from '@/shared/lib/session';
import { ExceptionQueue } from '@/features/exceptions';
import { TopBar } from '../../TopBar';

export const metadata: Metadata = { title: 'Exception' };
export const dynamic = 'force-dynamic';

/**
 * A deep link opens the queue with the panel already open, so a link pasted into a chat lands a
 * colleague on the finding itself rather than on a list they then have to search.
 */
export default async function ExceptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) redirect('/sign-in');

  const { id } = await params;

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
      <TopBar title="Exceptions" description="Deep link to a single finding" />
      <ExceptionQueue session={session} accounts={accounts} initialSelectedId={id} />
    </>
  );
}
