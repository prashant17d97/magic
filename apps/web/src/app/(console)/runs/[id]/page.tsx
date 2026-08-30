import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { RunDetail } from '@magic/contracts';
import { fetchFromApi } from '@/shared/lib/api-proxy';
import { readSession } from '@/shared/lib/session';
import { ChecksumReceipt } from '@/features/runs';
import { SeverityIndicator } from '@/shared/components/ui/SeverityIndicator';
import { Amount } from '@/shared/components/money/Amount';
import { formatTimestamp } from '@/shared/lib/money';
import { TopBar } from '../../TopBar';

export const metadata: Metadata = { title: 'Run detail' };
export const dynamic = 'force-dynamic';

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) redirect('/sign-in');

  const { id } = await params;

  let run: RunDetail;
  try {
    run = await fetchFromApi<RunDetail>(`/v1/runs/${id}`);
  } catch {
    notFound();
  }

  return (
    <>
      <TopBar
        title="Run detail"
        description={`Started ${formatTimestamp(run.started_at, session.tenant.timezone)}`}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="flex max-w-4xl flex-col gap-4">
          <ChecksumReceipt run={run} />

          <section className="surface">
            <header className="border-b border-[var(--border-subtle)] px-5 py-3">
              <h2 className="type-h3 text-[var(--text-primary)]">Findings from this run</h2>
              <p className="mt-0.5 type-caption text-[var(--text-secondary)]">
                {run.exceptions.length === 0
                  ? 'This run produced no findings.'
                  : `${run.exceptions.length} finding${run.exceptions.length === 1 ? '' : 's'}, in layer order`}
              </p>
            </header>

            {run.exceptions.length === 0 ? (
              <p className="px-5 py-8 text-center type-body-sm text-[var(--text-secondary)]">
                Every rule that applied to this scope passed.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {run.exceptions.map((exception) => (
                  <li key={exception.id}>
                    <Link
                      href={`/exceptions/${exception.id}`}
                      className="flex items-start gap-3 px-5 py-3 transition-colors duration-[var(--duration-instant)] hover:bg-[var(--bg-hover)]"
                    >
                      <SeverityIndicator severity={exception.severity} showLabel={false} className="mt-1" />
                      <div className="min-w-0 flex-1">
                        <p className="type-body-sm text-[var(--text-primary)]">{exception.narrative}</p>
                        <p className="mt-0.5 type-mono-sm text-[var(--text-tertiary)]">{exception.rule_id}</p>
                      </div>
                      <Amount
                        minor={exception.exposure_minor}
                        currency={exception.currency}
                        className="shrink-0 type-table font-medium text-[var(--text-primary)]"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {run.error ? (
            <section className="surface border-[var(--danger-border)] p-5">
              <h2 className="type-h3 text-[var(--danger-fg)]">This run failed</h2>
              <p className="mt-1.5 type-body-sm text-[var(--text-secondary)]">
                No partial findings were committed. The scope is unchanged from the previous run.
              </p>
              <pre className="mt-2.5 overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--bg-sunken)] p-2.5 type-mono text-[var(--text-secondary)]">
                {run.error}
              </pre>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
