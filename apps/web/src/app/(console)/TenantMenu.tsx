'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRightFromBracket, faBuilding, faCheck, faUser } from '@fortawesome/free-solid-svg-icons';
import type { SessionPayload } from '@magic/contracts';
import { cn } from '@/shared/lib/cn';
import { apiFetch } from '@/shared/lib/client';

/**
 * The tenant switcher sits at the bottom of the sidebar, visually separated from navigation.
 * Switching workspace is a context change rather than a navigation action, and it earns the
 * friction of a distinct location — in a multi-tenant financial tool, doing it by accident is
 * the sort of mistake that ends with someone resolving another company's exception.
 */
export function TenantMenu({ session, collapsed }: { session: SessionPayload; collapsed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  async function switchTenant(tenantId: string): Promise<void> {
    if (tenantId === session.tenant.id) {
      setOpen(false);
      return;
    }

    setSwitching(tenantId);
    try {
      await apiFetch('/api/session/tenant', { method: 'POST', body: { tenant_id: tenantId } });
      router.refresh();
      window.location.href = '/';
    } finally {
      setSwitching(null);
    }
  }

  async function signOut(): Promise<void> {
    await apiFetch('/api/session', { method: 'DELETE' });
    window.location.href = '/sign-in';
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={collapsed ? session.tenant.display_name : undefined}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left',
          'hover:bg-[var(--bg-hover)]',
          'max-md:justify-center max-md:px-0',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-xs)] bg-[var(--bg-selected)] text-[11px] font-semibold text-[var(--text-brand)]">
          {session.tenant.display_name.slice(0, 1).toUpperCase()}
        </span>
        {!collapsed ? (
          <span className="min-w-0 flex-1 max-md:hidden">
            <span className="block truncate type-body-sm font-medium text-[var(--text-primary)]">
              {session.tenant.display_name}
            </span>
            <span className="block truncate type-caption text-[var(--text-tertiary)]">
              {session.user.display_name} · {session.role}
            </span>
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute bottom-full left-0 z-[var(--z-popover)] mb-1 w-60 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-raised)] p-1 shadow-[var(--shadow-md)]"
          >
            <p className="px-2 py-1.5 type-label text-[var(--text-tertiary)]">Workspaces</p>
            {session.available_tenants.map((tenant) => (
              <button
                key={tenant.id}
                type="button"
                role="menuitem"
                onClick={() => void switchTenant(tenant.id)}
                disabled={switching !== null}
                className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left type-body-sm hover:bg-[var(--bg-hover)] disabled:opacity-60"
              >
                <FontAwesomeIcon icon={faBuilding} className="w-3.5 text-[11px] text-[var(--text-tertiary)]" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{tenant.display_name}</span>
                {tenant.id === session.tenant.id ? (
                  <FontAwesomeIcon icon={faCheck} className="text-[10px] text-[var(--text-brand)]" aria-hidden />
                ) : (
                  <span className="type-caption text-[var(--text-tertiary)]">{tenant.role}</span>
                )}
              </button>
            ))}

            <div className="my-1 h-px bg-[var(--border-subtle)]" />

            <div className="flex items-center gap-2 px-2 py-1.5 type-caption text-[var(--text-secondary)]">
              <FontAwesomeIcon icon={faUser} className="w-3.5 text-[11px] text-[var(--text-tertiary)]" aria-hidden />
              <span className="truncate">{session.user.email}</span>
            </div>

            <button
              type="button"
              role="menuitem"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left type-body-sm text-[var(--danger-fg)] hover:bg-[var(--danger-bg)]"
            >
              <FontAwesomeIcon icon={faArrowRightFromBracket} className="w-3.5 text-[11px]" aria-hidden />
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
