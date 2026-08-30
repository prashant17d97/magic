import { redirect } from 'next/navigation';
import { readSession } from '@/shared/lib/session';
import { fetchFromApi } from '@/shared/lib/api-proxy';
import type { ExceptionCounts } from '@magic/contracts';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { GlobalHotkeys } from './GlobalHotkeys';

/**
 * The session is re-checked here as well as in the proxy.
 *
 * Next 16 has had a run of middleware-bypass advisories, so authentication is never trusted to
 * the proxy alone: the layout that renders every console page asks again, on the server.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session) redirect('/sign-in');

  let criticalCount = 0;
  try {
    const counts = await fetchFromApi<ExceptionCounts>('/v1/exceptions/counts');
    criticalCount = counts.open_exposure
      .filter((row) => row.severity === 'critical')
      .reduce((total, row) => total + row.count, 0);
  } catch {
    criticalCount = 0;
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--bg-base)]">
      <Sidebar session={session} criticalCount={criticalCount} />
      <main id="main" className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
      <CommandPalette />
      <GlobalHotkeys />
    </div>
  );
}
