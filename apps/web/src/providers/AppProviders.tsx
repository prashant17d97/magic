'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { ToastProvider } from '@/shared/components/feedback/Toast';
import { useConsoleStore } from '@/shared/hooks/useConsoleStore';

/**
 * `refetchOnWindowFocus` is on here, unlike most applications.
 *
 * An operator alt-tabs to Stripe, resolves something there, and comes back. Stale data at that
 * exact moment causes a wrong decision, and a wrong decision about money is the failure this
 * product exists to prevent.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 2,
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 30_000),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: 0 },
    },
  });
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const theme = useConsoleStore((state) => state.theme);
  const density = useConsoleStore((state) => state.density);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>
        <ToastProvider>{children}</ToastProvider>
      </NuqsAdapter>
    </QueryClientProvider>
  );
}
