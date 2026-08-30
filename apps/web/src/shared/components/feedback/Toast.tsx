'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck, faCircleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons';
import { cn } from '@/shared/lib/cn';

interface Toast {
  id: number;
  tone: 'success' | 'danger' | 'info';
  message: string;
  detail?: string | undefined;
}

interface ToastApi {
  push(toast: Omit<Toast, 'id'>): void;
}

const ToastContext = createContext<ToastApi>({ push: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/**
 * Confirmation is quiet. Resolving a discrepancy is a serious act recorded properly, not a
 * celebration, so the toast states what happened and leaves.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5_000);
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed top-4 right-4 flex w-80 flex-col gap-2"
        style={{ zIndex: 'var(--z-toast)' }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5',
              'bg-[var(--bg-raised)] shadow-[var(--shadow-md)]',
              toast.tone === 'success' && 'border-[var(--success-border)]',
              toast.tone === 'danger' && 'border-[var(--danger-border)]',
              toast.tone === 'info' && 'border-[var(--border-default)]',
            )}
          >
            <FontAwesomeIcon
              icon={toast.tone === 'danger' ? faCircleExclamation : faCircleCheck}
              className={cn(
                'mt-0.5 text-[13px]',
                toast.tone === 'danger' ? 'text-[var(--danger-fg)]' : 'text-[var(--success-fg)]',
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="type-body-sm font-medium text-[var(--text-primary)]">{toast.message}</p>
              {toast.detail ? (
                <p className="mt-0.5 type-caption text-[var(--text-secondary)]">{toast.detail}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              aria-label="Dismiss"
            >
              <FontAwesomeIcon icon={faXmark} className="text-[12px]" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
