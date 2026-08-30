import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { Member } from '@magic/contracts';
import { fetchFromApi } from '@/shared/lib/api-proxy';
import { readSession } from '@/shared/lib/session';
import { Badge } from '@/shared/components/ui/Badge';
import { EmptyState } from '@/shared/components/feedback/States';
import { formatAge } from '@/shared/lib/money';

export const metadata: Metadata = { title: 'Members' };
export const dynamic = 'force-dynamic';

/**
 * Permission is `(role, account scope)`.
 *
 * A marketplace operator is often responsible for a subset of sellers, so scope is a first-class
 * dimension rather than something bolted on later — retrofitting it across every query would be
 * a rewrite, and modelling it now costs one column.
 */
export default async function MembersPage() {
  const session = await readSession();
  if (!session) redirect('/sign-in');

  if (!session.permissions.includes('member:read')) {
    return (
      <EmptyState
        variant="not-started"
        title="Member management is admin-only"
        body="Ask an admin in this workspace to change roles or account scopes."
      />
    );
  }

  const { data } = await fetchFromApi<{ data: Member[] }>('/v1/members');

  return (
    <div className="max-w-4xl">
      <div className="surface overflow-hidden">
        <header className="border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 className="type-h3 text-[var(--text-primary)]">Workspace members</h2>
          <p className="mt-0.5 type-caption text-[var(--text-secondary)]">
            A member with an account scope sees and acts on only those connected accounts.
          </p>
        </header>

        <table className="w-full">
          <caption className="sr-only">Members, roles and account scopes</caption>
          <thead>
            <tr className="border-b border-[var(--border-default)]">
              <th scope="col" className="type-table-head px-4 py-2 text-left text-[var(--text-secondary)]">Member</th>
              <th scope="col" className="type-table-head px-4 py-2 text-left text-[var(--text-secondary)]">Role</th>
              <th scope="col" className="type-table-head px-4 py-2 text-left text-[var(--text-secondary)]">Account scope</th>
              <th scope="col" className="type-table-head px-4 py-2 text-right text-[var(--text-secondary)]">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {data.map((member) => (
              <tr key={member.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-4 py-2.5">
                  <p className="type-body-sm text-[var(--text-primary)]">{member.display_name}</p>
                  <p className="type-caption text-[var(--text-tertiary)]">{member.email}</p>
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={member.role === 'admin' ? 'brand' : member.role === 'member' ? 'info' : 'muted'}>
                    {member.role}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 type-table text-[var(--text-secondary)]">
                  {member.account_scope?.length ? (
                    <span className="type-mono-sm">{member.account_scope.join(', ')}</span>
                  ) : (
                    'All accounts'
                  )}
                </td>
                <td className="px-4 py-2.5 text-right type-table text-[var(--text-secondary)]">
                  {formatAge(member.last_login_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
