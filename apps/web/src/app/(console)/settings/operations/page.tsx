import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { fetchFromApi } from '@/shared/lib/api-proxy';
import { readSession } from '@/shared/lib/session';
import { EmptyState } from '@/shared/components/feedback/States';
import { DeadLetterQueue } from '@/features/exports';

export const metadata: Metadata = { title: 'Operations' };
export const dynamic = 'force-dynamic';

interface DeadLetter {
  id: string;
  original_queue: string;
  job_key: string;
  error_message: string;
  failed_at: string;
  attempts: number;
  replayed_at: string | null;
}

/**
 * A permanently failed job is unacceptable in a financial system, so the dead-letter queue is a
 * work surface with a human path back in rather than a graveyard to be cleared.
 */
export default async function OperationsPage() {
  const session = await readSession();
  if (!session) redirect('/sign-in');

  if (!session.permissions.includes('ops:dlq')) {
    return (
      <EmptyState
        variant="not-started"
        title="Operations is admin-only"
        body="Replaying a failed job re-enqueues real work, so it is restricted to admins."
      />
    );
  }

  const { data } = await fetchFromApi<{ data: DeadLetter[] }>('/v1/ops/dlq', { limit: 50 });

  return (
    <div className="max-w-4xl">
      <DeadLetterQueue jobs={data} timezone={session.tenant.timezone} />
    </div>
  );
}
