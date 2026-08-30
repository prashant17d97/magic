import type { Metadata } from 'next';
import type { HealthSummary } from '@magic/contracts';
import { fetchFromApi } from '@/shared/lib/api-proxy';
import { readSession } from '@/shared/lib/session';
import { ErrorState } from '@/shared/components/feedback/States';
import { formatTimestamp } from '@/shared/lib/money';
import { TopBar } from '../(console)/TopBar';
import { AccountsNeedingAttention, ExposurePanel, HealthTiles, RecentRuns, TrendChart } from '@/features/health';

export const metadata: Metadata = { title: 'Health' };
export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  const session = await readSession();

  let summary: HealthSummary | null = null;
  let error: string | null = null;

  try {
    summary = await fetchFromApi<HealthSummary>('/v1/health/summary');
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'Unknown error';
  }

  if (!summary) {
    return (
      <>
        <TopBar title="Health" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ErrorState body="The health summary could not be loaded. Your data is unaffected." traceId={error} />
        </div>
      </>
    );
  }

  const verified = summary.completeness.last_checked_at
    ? formatTimestamp(summary.completeness.last_checked_at, session?.tenant.timezone ?? 'UTC')
    : 'not yet';

  return (
    <>
      <TopBar
        title="Health"
        description={`Completeness verified ${verified}`}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="flex flex-col gap-4">
          <HealthTiles summary={summary} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ExposurePanel exposure={summary.exposure} />
            <TrendChart trend={summary.trend} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <AccountsNeedingAttention accounts={summary.accounts_needing_attention} />
            <RecentRuns runs={summary.recent_runs} />
          </div>
        </div>
      </div>
    </>
  );
}
