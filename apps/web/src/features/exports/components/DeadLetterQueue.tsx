'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { faRotateRight } from '@fortawesome/free-solid-svg-icons';
import { Badge } from '@/shared/components/ui/Badge';
import { Button } from '@/shared/components/ui/Button';
import { EmptyState } from '@/shared/components/feedback/States';
import { ObjectId } from '@/shared/components/money/ObjectId';
import { useToast } from '@/shared/components/feedback/Toast';
import { apiFetch } from '@/shared/lib/client';
import { formatTimestamp } from '@/shared/lib/money';

interface DeadLetter {
  id: string;
  original_queue: string;
  job_key: string;
  error_message: string;
  failed_at: string;
  attempts: number;
  replayed_at: string | null;
}

export function DeadLetterQueue({ jobs, timezone }: { jobs: DeadLetter[]; timezone: string }) {
  const router = useRouter();
  const toast = useToast();
  const [replaying, setReplaying] = useState<string | null>(null);

  async function replay(id: string): Promise<void> {
    setReplaying(id);
    try {
      await apiFetch(`/api/ops/dlq/${id}/replay`, { method: 'POST' });
      toast.push({
        tone: 'success',
        message: 'Job re-enqueued',
        detail: 'It goes back on its original queue with its original key, so a repeat is the same job.',
      });
      router.refresh();
    } catch (caught) {
      toast.push({
        tone: 'danger',
        message: 'The replay did not start',
        detail: caught instanceof Error ? caught.message : undefined,
      });
    } finally {
      setReplaying(null);
    }
  }

  return (
    <section className="surface overflow-hidden">
      <header className="border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="type-h3 text-[var(--text-primary)]">Dead-lettered jobs</h2>
        <p className="mt-0.5 type-caption text-[var(--text-secondary)]">
          Jobs that exhausted their retries, preserved with full context. Nothing is dropped.
        </p>
      </header>

      {jobs.length === 0 ? (
        <EmptyState
          variant="all-clear"
          title="Nothing dead-lettered"
          body="Every job has either completed or is still retrying within its policy."
        />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {jobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="danger">{job.original_queue}</Badge>
                  <ObjectId id={job.job_key} />
                  <span className="type-caption text-[var(--text-tertiary)]">
                    {job.attempts} attempt{job.attempts === 1 ? '' : 's'} · {formatTimestamp(job.failed_at, timezone)}
                  </span>
                </div>
                <p className="mt-1.5 type-caption text-[var(--text-secondary)]">{job.error_message}</p>
              </div>

              {job.replayed_at ? (
                <Badge tone="success">Replayed</Badge>
              ) : (
                <Button
                  size="sm"
                  icon={faRotateRight}
                  loading={replaying === job.id}
                  onClick={() => void replay(job.id)}
                >
                  Replay
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
