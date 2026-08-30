'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CSSProperties } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRightArrowLeft,
  faBuildingColumns,
  faChevronLeft,
  faClipboardList,
  faDownload,
  faGauge,
  faGear,
  faRotate,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { SessionPayload } from '@magic/contracts';
import { cn } from '@/shared/lib/cn';
import { useConsoleStore } from '@/shared/hooks/useConsoleStore';
import { Wordmark } from '@/shared/components/ui/Wordmark';
import { TenantMenu } from './TenantMenu';

interface NavItem {
  href: string;
  label: string;
  icon: IconDefinition;
  permission?: string;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Health', icon: faGauge },
  { href: '/exceptions', label: 'Exceptions', icon: faTriangleExclamation },
  { href: '/runs', label: 'Runs', icon: faRotate },
  { href: '/settlements', label: 'Settlements', icon: faArrowRightArrowLeft },
  { href: '/accounts', label: 'Accounts', icon: faBuildingColumns },
  { href: '/exports', label: 'Exports', icon: faDownload },
  { href: '/audit', label: 'Audit', icon: faClipboardList, permission: 'audit:read' },
  { href: '/settings/rules', label: 'Settings', icon: faGear },
];

/**
 * Navigation is flat and shallow: every primary destination is one click.
 *
 * Only the critical count gets a badge. A badge on every item is a badge on nothing, and the one
 * number worth interrupting someone for is money that is provably missing.
 *
 * Below the medium breakpoint the rail is forced narrow regardless of the stored preference,
 * because a 240px sidebar on a 390px screen leaves 150px of content and every page overflows
 * sideways. That is expressed in CSS rather than in state so it needs no measurement on the
 * client and cannot disagree with what the server rendered.
 */
export function Sidebar({ session, criticalCount }: { session: SessionPayload; criticalCount: number }) {
  const pathname = usePathname();
  const collapsed = useConsoleStore((state) => state.sidebarCollapsed);
  const toggle = useConsoleStore((state) => state.toggleSidebar);

  const visible = NAV.filter((item) => !item.permission || session.permissions.includes(item.permission as never));

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'flex shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]',
        'transition-[width] duration-[var(--duration-base)] ease-[var(--ease-inout)]',
        'w-[var(--rail-width)] max-md:w-[var(--sidebar-width-collapsed)]',
      )}
      style={{ '--rail-width': collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)' } as CSSProperties}
    >
      <div
        className={cn(
          'flex h-14 items-center border-b border-[var(--border-subtle)] max-md:justify-center max-md:px-2',
          collapsed ? 'justify-center px-2' : 'px-4',
        )}
      >
        <Link href="/" className="flex items-center rounded-[var(--radius-sm)]">
          <Wordmark collapsed={collapsed} />
          <span className="sr-only">MAGIC — go to health overview</span>
        </Link>
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 p-2">
        {visible.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href.split('/').slice(0, 2).join('/'));
          const badge = item.href === '/exceptions' && criticalCount > 0 ? criticalCount : null;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                title={collapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 type-body-sm',
                  'transition-colors duration-[var(--duration-instant)]',
                  active
                    ? 'bg-[var(--bg-selected)] font-medium text-[var(--text-brand)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                  'max-md:justify-center max-md:px-0',
                  collapsed && 'justify-center px-0',
                )}
              >
                <FontAwesomeIcon icon={item.icon} className="w-4 shrink-0 text-[13px]" aria-hidden />
                {!collapsed ? <span className="flex-1 truncate max-md:hidden">{item.label}</span> : null}
                {badge !== null && !collapsed ? (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[var(--radius-full)] bg-[var(--danger-fill)] px-1 text-[10px] font-semibold text-[var(--danger-on-fill)] max-md:hidden">
                    {badge}
                  </span>
                ) : null}
                {badge !== null ? (
                  <span
                    className={cn(
                      'absolute ml-4 -mt-4 size-1.5 rounded-full bg-[var(--danger-fill)]',
                      collapsed ? 'block' : 'hidden max-md:block',
                    )}
                    aria-hidden
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-[var(--border-subtle)] p-2">
        <TenantMenu session={session} collapsed={collapsed} />
        <button
          type="button"
          onClick={toggle}
          className={cn(
            'mt-1 flex h-7 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 max-md:hidden',
            'type-caption text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
            collapsed && 'justify-center px-0',
          )}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          <FontAwesomeIcon
            icon={faChevronLeft}
            className={cn('text-[11px] transition-transform duration-[var(--duration-base)]', collapsed && 'rotate-180')}
            aria-hidden
          />
          {!collapsed ? <span>Collapse</span> : null}
        </button>
      </div>
    </nav>
  );
}
