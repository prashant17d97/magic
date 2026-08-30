import type { Metadata } from 'next';
import { ExportsPanel } from '@/features/exports';
import { TopBar } from '../TopBar';

export const metadata: Metadata = { title: 'Exports' };
export const dynamic = 'force-dynamic';

export default function ExportsPage() {
  return (
    <>
      <TopBar title="Exports" description="Asynchronous generation with expiring, scope-locked links" />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="max-w-3xl">
          <ExportsPanel />
        </div>
      </div>
    </>
  );
}
