'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowUpRightFromSquare, faUserPlus } from '@fortawesome/free-solid-svg-icons';
import type { ExceptionDetail, ExceptionStatus, Member } from '@magic/contracts';
import { Drawer } from '@/shared/components/data/Drawer';
import { Button } from '@/shared/components/ui/Button';
import { SeverityIndicator } from '@/shared/components/ui/SeverityIndicator';
import { StatusChip } from '@/shared/components/ui/StatusChip';
import { Amount } from '@/shared/components/money/Amount';
import { ObjectId } from '@/shared/components/money/ObjectId';
import { TableSkeleton } from '@/shared/components/feedback/States';
import { useToast } from '@/shared/components/feedback/Toast';
import { apiFetch } from '@/shared/lib/client';
import { formatTimestamp } from '@/shared/lib/money';
import { cn } from '@/shared/lib/cn';
import { EvidenceDiff } from './EvidenceDiff';
import { exceptionKeys, useInvalidateExceptions } from '../hooks/useExceptionQueue';

type PendingAction = 'resolve' | 'ignore' | 'assign' | null;

export function ExceptionDetailPanel({
  exceptionId,
  onClose,
  canTransition,
  timezone,
  requestedAction,
  onActionHandled,
}: {
  exceptionId: string | null;
  onClose(): void;
  canTransition: boolean;
  timezone: string;
  requestedAction?: PendingAction;
  onActionHandled?(): void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateExceptions();
  const [action, setAction] = useState<PendingAction>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: exceptionKeys.detail(exceptionId ?? ''),
    queryFn: () => apiFetch<ExceptionDetail>(`/api/exceptions/${exceptionId}`),
    enabled: exceptionId !== null,
  });

  const { data: members } = useQuery({
    queryKey: ['members'],
    queryFn: () => apiFetch<{ data: Member[] }>('/api/members'),
    enabled: action === 'assign',
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (requestedAction) {
      setAction(requestedAction);
      onActionHandled?.();
    }
  }, [requestedAction, onActionHandled]);

  useEffect(() => {
    if (action === 'resolve' || action === 'ignore') noteRef.current?.focus();
  }, [action]);

  useEffect(() => {
    setAction(null);
    setNote('');
  }, [exceptionId]);

  /**
   * No optimistic update, ever, on a financial mutation.
   *
   * The button shows a pending state and waits for the server. If it fails, nothing was ever
   * misrepresented as done — and in a product whose entire premise is accuracy, showing a state
   * that might not be true would undermine the thing being sold.
   */
  async function transition(to: ExceptionStatus): Promise<void> {
    if (!exceptionId) return;
    setSubmitting(true);

    try {
      await apiFetch(`/api/exceptions/${exceptionId}/transitions`, {
        method: 'POST',
        body: { to, note: note.trim() || undefined },
      });

      invalidate();
      toast.push({
        tone: 'success',
        message: to === 'resolved' ? 'Exception resolved' : to === 'ignored' ? 'Exception ignored' : 'Status updated',
        detail: 'Recorded with your name and the time.',
      });
      setAction(null);
      setNote('');
      onClose();
    } catch (caught) {
      toast.push({
        tone: 'danger',
        message: 'That change was not saved',
        detail: caught instanceof Error ? caught.message : 'The server rejected the request.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function assign(assigneeId: string | null): Promise<void> {
    if (!exceptionId) return;
    setSubmitting(true);

    try {
      await apiFetch('/api/exceptions/bulk/assign', {
        method: 'POST',
        body: { ids: [exceptionId], assignee_id: assigneeId },
      });
      invalidate();
      toast.push({ tone: 'success', message: assigneeId ? 'Assigned' : 'Assignment cleared' });
      setAction(null);
    } catch (caught) {
      toast.push({
        tone: 'danger',
        message: 'That change was not saved',
        detail: caught instanceof Error ? caught.message : 'The server rejected the request.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={exceptionId !== null}
      onClose={onClose}
      title={data?.rule_name ?? 'Exception'}
      footer={
        canTransition && data ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={() => setAction(action === 'resolve' ? null : 'resolve')}
              disabled={submitting}
            >
              Resolve
            </Button>
            <Button onClick={() => setAction(action === 'ignore' ? null : 'ignore')} disabled={submitting}>
              Ignore
            </Button>
            <Button
              icon={faUserPlus}
              onClick={() => setAction(action === 'assign' ? null : 'assign')}
              disabled={submitting}
            >
              Assign
            </Button>
            <a
              href={`/settlements?q=${encodeURIComponent(data.subject_id)}`}
              className="ml-auto inline-flex items-center gap-1.5 type-body-sm text-[var(--text-link)] hover:underline"
            >
              Open in settlements
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-[10px]" aria-hidden />
            </a>
          </div>
        ) : null
      }
    >
      {isLoading ? (
        <div className="p-5">
          <TableSkeleton rows={6} columns={3} />
        </div>
      ) : error || !data ? (
        <div className="p-5">
          <p className="type-body-sm text-[var(--text-secondary)]">
            This finding could not be loaded. Your data is unaffected.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 p-5">
          <section>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityIndicator severity={data.severity} />
              <StatusChip status={data.status} />
              <span className="type-mono-sm text-[var(--text-tertiary)]">{data.rule_id}</span>
            </div>
            <p className="mt-2.5 type-body text-[var(--text-primary)]">{data.narrative}</p>
          </section>

          <section className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] p-4">
            <p className="type-label text-[var(--text-tertiary)]">Exposure</p>
            <p className="type-kpi mt-1 text-[var(--text-primary)]">
              <Amount minor={data.exposure_minor} currency={data.currency} />
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
              <Meta label="Account" value={data.account_display_name ?? data.stripe_account_id} />
              <Meta label="Subject" value={data.subject_type} />
              <Meta label="First seen" value={formatTimestamp(data.first_seen_at, timezone)} />
            </dl>
          </section>

          <section>
            <h3 className="type-label mb-2.5 text-[var(--text-tertiary)]">Evidence</h3>
            <EvidenceDiff expected={data.expected} actual={data.actual} currency={data.currency} />
          </section>

          {data.linked_objects.length > 0 ? (
            <section>
              <h3 className="type-label mb-2 text-[var(--text-tertiary)]">Linked objects</h3>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                {data.linked_objects.map((object, index) => (
                  <li key={`${object.id}:${index}`} className="flex items-center gap-1.5">
                    <span className="type-caption text-[var(--text-tertiary)]">{object.label}</span>
                    <ObjectId id={object.id} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h3 className="type-label mb-2 text-[var(--text-tertiary)]">Rule trace</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
              <Meta label="Rule" value={`${data.rule_trace.rule_id} · v${data.rule_trace.rule_version}`} mono />
              <Meta label="Layer" value={`Layer ${data.rule_trace.layer} · ${data.rule_trace.mode}`} />
              <Meta label="Maturity window" value={formatDuration(data.rule_trace.maturity_seconds)} />
              <Meta label="Evaluated" value={formatTimestamp(data.rule_trace.evaluated_at, timezone)} />
            </dl>
            {Object.keys(data.rule_trace.parameters).length > 0 ? (
              <pre className="mt-2.5 overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-sunken)] p-2.5 type-mono text-[var(--text-secondary)]">
                {JSON.stringify(data.rule_trace.parameters, null, 2)}
              </pre>
            ) : null}
          </section>

          {data.matched_order ? (
            <section>
              <h3 className="type-label mb-2 text-[var(--text-tertiary)]">Matched order</h3>
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-2">
                <span className="type-body-sm text-[var(--text-primary)]">{data.matched_order.external_order_id}</span>
                <span className="type-caption text-[var(--text-tertiary)]">{data.matched_order.tier} match</span>
                <Amount
                  minor={data.matched_order.total_minor}
                  currency={data.matched_order.currency}
                  className="type-table"
                />
              </div>
            </section>
          ) : null}

          <section>
            <h3 className="type-label mb-2.5 text-[var(--text-tertiary)]">History</h3>
            <ol className="flex flex-col gap-2.5">
              {data.history.map((event) => (
                <li key={event.id} className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      'mt-1.5 size-1.5 shrink-0 rounded-full',
                      event.to_status === 'resolved'
                        ? 'bg-[var(--success-fg)]'
                        : event.to_status === 'ignored'
                          ? 'bg-[var(--muted-fg)]'
                          : 'bg-[var(--info-fg)]',
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="type-body-sm text-[var(--text-primary)]">
                      {event.from_status ? `${event.from_status} → ${event.to_status}` : event.to_status}
                      <span className="ml-1.5 text-[var(--text-tertiary)]">
                        {event.actor_name ?? (event.actor_type === 'system' ? 'system' : 'unknown')}
                      </span>
                    </p>
                    {event.note ? (
                      <p className="mt-0.5 type-caption text-[var(--text-secondary)]">{event.note}</p>
                    ) : null}
                    <p className="mt-0.5 type-caption text-[var(--text-tertiary)]">
                      {formatTimestamp(event.created_at, timezone)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {action === 'resolve' || action === 'ignore' ? (
            <section className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-4">
              <label htmlFor="resolution-note" className="type-label text-[var(--text-tertiary)]">
                {action === 'resolve' ? 'Resolution note' : 'Reason for ignoring'}
              </label>
              <p className="mt-1 type-caption text-[var(--text-secondary)]">
                A finding closed without a reason is not closed. This is recorded against your name.
              </p>
              <textarea
                id="resolution-note"
                ref={noteRef}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                required
                aria-describedby="note-help"
                className="mt-2 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-2.5 type-body-sm focus:border-[var(--border-focus)] focus:outline-none"
              />
              <div className="mt-2.5 flex items-center gap-2">
                <Button
                  variant="primary"
                  loading={submitting}
                  disabled={note.trim().length < 3}
                  onClick={() => void transition(action === 'resolve' ? 'resolved' : 'ignored')}
                >
                  {action === 'resolve' ? 'Confirm resolve' : 'Confirm ignore'}
                </Button>
                <Button variant="ghost" onClick={() => setAction(null)} disabled={submitting}>
                  Cancel
                </Button>
                <span id="note-help" className="type-caption text-[var(--text-tertiary)]">
                  {note.trim().length < 3 ? 'A note of at least three characters is required.' : ' '}
                </span>
              </div>
            </section>
          ) : null}

          {action === 'assign' ? (
            <section className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-4">
              <p className="type-label text-[var(--text-tertiary)]">Assign to</p>
              <div className="mt-2 flex flex-col gap-1">
                {(members?.data ?? []).map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    disabled={submitting}
                    onClick={() => void assign(member.user_id)}
                    className="flex items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left type-body-sm hover:bg-[var(--bg-hover)]"
                  >
                    <span>{member.display_name}</span>
                    <span className="type-caption text-[var(--text-tertiary)]">{member.role}</span>
                  </button>
                ))}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void assign(null)}
                  className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left type-body-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  Clear assignment
                </button>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="type-caption text-[var(--text-tertiary)]">{label}</dt>
      <dd className={cn('mt-0.5 m-0 truncate text-[var(--text-primary)]', mono ? 'type-mono' : 'type-body-sm')}>
        {value}
      </dd>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return 'none — evaluated immediately';
  if (seconds < 3_600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
}
