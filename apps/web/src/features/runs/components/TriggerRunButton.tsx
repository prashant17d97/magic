'use client';

import { useState } from 'react';
import { faPlay } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@/shared/components/ui/Button';
import { useToast } from '@/shared/components/feedback/Toast';
import { apiFetch } from '@/shared/lib/client';

/**
 * Re-running is safe and the copy says so plainly.
 *
 * Identity is the rule, the subject and the scope, so a re-run updates findings that still hold
 * and closes the ones that no longer do. It cannot duplicate a finding, and it cannot resurrect
 * one somebody resolved unless the underlying figures actually moved.
 */
export function TriggerRunButton({
  accounts,
  onDone,
}: {
  accounts: { value: string; label: string }[];
  onDone(): void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.value ?? '');
  const [payoutId, setPayoutId] = useState('');
  const [running, setRunning] = useState(false);

  async function trigger(): Promise<void> {
    setRunning(true);
    try {
      await apiFetch('/api/runs', {
        method: 'POST',
        body: { account_id: accountId, payout_id: payoutId.trim() || undefined },
      });
      toast.push({ tone: 'success', message: 'Reconciliation complete', detail: 'The run history is up to date.' });
      setOpen(false);
      setPayoutId('');
      onDone();
    } catch (caught) {
      toast.push({
        tone: 'danger',
        message: 'The run did not start',
        detail: caught instanceof Error ? caught.message : undefined,
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="relative">
      <Button icon={faPlay} size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        Re-run
      </Button>

      {open ? (
        <>
          <div className="fixed inset-0" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute top-full right-0 z-[var(--z-popover)] mt-1 w-80 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-raised)] p-3 shadow-[var(--shadow-md)]">
            <p className="type-label text-[var(--text-tertiary)]">Re-run reconciliation</p>
            <p className="mt-1 type-caption text-[var(--text-secondary)]">
              Findings that still hold are updated; ones that no longer hold are closed. Nothing you have
              already resolved comes back unless the figures changed.
            </p>

            <label className="mt-3 block type-caption text-[var(--text-secondary)]" htmlFor="run-account">
              Account
            </label>
            <select
              id="run-account"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 type-body-sm focus:border-[var(--border-focus)] focus:outline-none"
            >
              {accounts.map((account) => (
                <option key={account.value} value={account.value}>
                  {account.label}
                </option>
              ))}
            </select>

            <label className="mt-2.5 block type-caption text-[var(--text-secondary)]" htmlFor="run-payout">
              Payout id (optional)
            </label>
            <input
              id="run-payout"
              value={payoutId}
              onChange={(event) => setPayoutId(event.target.value)}
              placeholder="po_…"
              className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 type-mono focus:border-[var(--border-focus)] focus:outline-none"
            />

            <Button
              variant="primary"
              size="sm"
              className="mt-3 w-full"
              loading={running}
              disabled={!accountId}
              onClick={() => void trigger()}
            >
              Run now
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
