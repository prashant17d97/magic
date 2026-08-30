'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBookmark, faTrash, faUsers } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@/shared/components/ui/Button';
import { apiFetch, buildQuery } from '@/shared/lib/client';
import { useToast } from '@/shared/components/feedback/Toast';

interface SavedView {
  id: string;
  name: string;
  resource: string;
  query: Record<string, unknown>;
  shared: boolean;
  owner_user_id: string;
}

/**
 * A saved view stores the whole working configuration — filters, sort and column state — because
 * an operator's queue is a habit, not a query. Sharing one to the workspace is opt-in: the
 * default is private, so an experiment does not become everyone's default view.
 */
export function SavedViews({ resource }: { resource: 'exceptions' | 'settlements' | 'runs' }) {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);

  const { data } = useQuery({
    queryKey: ['saved-views', resource],
    queryFn: () => apiFetch<{ data: SavedView[] }>(`/api/saved-views?resource=${resource}`),
    staleTime: 60_000,
  });

  async function save(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const query: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) {
      if (key === 'cursor') continue;
      query[key] = value;
    }

    try {
      await apiFetch('/api/saved-views', {
        method: 'POST',
        body: { name: name.trim(), resource, query, shared },
      });
      await queryClient.invalidateQueries({ queryKey: ['saved-views', resource] });
      setName('');
      setOpen(false);
      toast.push({ tone: 'success', message: 'View saved' });
    } catch (caught) {
      toast.push({
        tone: 'danger',
        message: 'The view was not saved',
        detail: caught instanceof Error ? caught.message : undefined,
      });
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await apiFetch(`/api/saved-views/${id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: ['saved-views', resource] });
    } catch (caught) {
      toast.push({
        tone: 'danger',
        message: 'The view was not deleted',
        detail: caught instanceof Error ? caught.message : undefined,
      });
    }
  }

  const views = data?.data ?? [];

  return (
    <div className="relative">
      <Button size="sm" icon={faBookmark} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        Saved views
      </Button>

      {open ? (
        <>
          <div className="fixed inset-0" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute top-full right-0 z-[var(--z-popover)] mt-1 w-72 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-raised)] p-2 shadow-[var(--shadow-md)]">
            {views.length === 0 ? (
              <p className="px-2 py-3 type-caption text-[var(--text-tertiary)]">No saved views yet.</p>
            ) : (
              <ul className="flex flex-col">
                {views.map((view) => (
                  <li key={view.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        router.push(`/${resource}${buildQuery(view.query)}`);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left type-body-sm hover:bg-[var(--bg-hover)]"
                    >
                      <span className="truncate">{view.name}</span>
                      {view.shared ? (
                        <FontAwesomeIcon
                          icon={faUsers}
                          className="ml-auto text-[10px] text-[var(--text-tertiary)]"
                          title="Shared with the workspace"
                        />
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(view.id)}
                      aria-label={`Delete ${view.name}`}
                      className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--danger-fg)]"
                    >
                      <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Save this view as…"
                aria-label="Saved view name"
                className="h-7 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 type-body-sm focus:border-[var(--border-focus)] focus:outline-none"
              />
              <label className="mt-1.5 flex items-center gap-1.5 type-caption text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={shared}
                  onChange={(event) => setShared(event.target.checked)}
                  className="size-3 accent-[var(--brand-fill)]"
                />
                Share with the workspace
              </label>
              <Button
                size="sm"
                variant="primary"
                className="mt-1.5 w-full"
                disabled={name.trim().length === 0}
                onClick={() => void save()}
              >
                Save view
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
