import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { fetchFromApi } from '@/shared/lib/api-proxy';
import { readSession } from '@/shared/lib/session';
import { Badge } from '@/shared/components/ui/Badge';
import { ObjectId } from '@/shared/components/money/ObjectId';
import { EmptyState } from '@/shared/components/feedback/States';
import { formatTimestamp } from '@/shared/lib/money';
import { TopBar } from '../TopBar';

export const metadata: Metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

interface AuditEntry {
  id: string;
  actor_type: 'user' | 'system' | 'api';
  actor_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  ip_address: string | null;
  request_id: string | null;
  created_at: string;
}

/**
 * Append-only, and enforced as such: the application role has no UPDATE or DELETE grant on this
 * table. An auditor needs to see what was flagged, who closed it, on what evidence and under
 * which rule version — a record that can be edited answers none of those questions.
 */
export default async function AuditPage() {
  const session = await readSession();
  if (!session) redirect('/sign-in');

  if (!session.permissions.includes('audit:read')) {
    return (
      <>
        <TopBar title="Audit log" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EmptyState
            variant="not-started"
            title="The audit log is not available to your role"
            body="Admins and auditors can read the full action history."
          />
        </div>
      </>
    );
  }

  const { data } = await fetchFromApi<{ data: AuditEntry[] }>('/v1/audit', { limit: 100 });

  return (
    <>
      <TopBar title="Audit log" description="Every state-changing action, retained for seven years" />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="surface overflow-hidden">
          {data.length === 0 ? (
            <EmptyState variant="not-started" title="No recorded actions" body="Actions appear here as they happen." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <caption className="sr-only">Append-only record of state-changing actions</caption>
                <thead className="bg-[var(--bg-surface)]">
                  <tr className="border-b border-[var(--border-default)]">
                    <th scope="col" className="type-table-head px-4 py-2 text-left text-[var(--text-secondary)]">When</th>
                    <th scope="col" className="type-table-head px-4 py-2 text-left text-[var(--text-secondary)]">Actor</th>
                    <th scope="col" className="type-table-head px-4 py-2 text-left text-[var(--text-secondary)]">Action</th>
                    <th scope="col" className="type-table-head px-4 py-2 text-left text-[var(--text-secondary)]">Resource</th>
                    <th scope="col" className="type-table-head px-4 py-2 text-left text-[var(--text-secondary)]">Request</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((entry) => (
                    <tr key={entry.id} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="px-4 py-2 type-table whitespace-nowrap text-[var(--text-secondary)]">
                        {formatTimestamp(entry.created_at, session.tenant.timezone)}
                      </td>
                      <td className="px-4 py-2 type-table">
                        <span className="text-[var(--text-primary)]">{entry.actor_name ?? entry.actor_type}</span>
                        {entry.ip_address ? (
                          <span className="ml-2 type-mono-sm text-[var(--text-tertiary)]">{entry.ip_address}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 type-table">
                        <Badge tone={entry.action.includes('delete') ? 'danger' : 'muted'}>{entry.action}</Badge>
                      </td>
                      <td className="px-4 py-2 type-table">
                        <span className="text-[var(--text-secondary)]">{entry.resource_type}</span>
                        <span className="mx-1.5 text-[var(--text-tertiary)]">·</span>
                        <ObjectId id={entry.resource_id} />
                      </td>
                      <td className="px-4 py-2">
                        {entry.request_id ? <ObjectId id={entry.request_id} /> : <span className="type-table">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
