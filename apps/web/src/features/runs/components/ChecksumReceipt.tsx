import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { RunDetail } from '@magic/contracts';
import { Amount } from '@/shared/components/money/Amount';
import { ObjectId } from '@/shared/components/money/ObjectId';
import { cn } from '@/shared/lib/cn';
import { formatCount } from '@/shared/lib/money';

/**
 * The checksum receipt.
 *
 * A payout is an actual bank deposit and decomposes exactly into its balance transactions, so the
 * result is set the way an accountant would set it: aligned figures, a hairline rule above the
 * total, and the difference carrying the most weight on the page. A balanced run should read as a
 * receipt rather than as the absence of an error — it is the number finance ties to the statement,
 * and it deserves to look like one.
 */
export function ChecksumReceipt({ run }: { run: RunDetail }) {
  const scoped = run.payout_id !== null;

  /**
   * A window run has no bank deposit and therefore no checksum. Reporting it as balanced would
   * claim a reconciliation that never happened, which is the one thing this screen must not do.
   */
  const balanced = scoped && run.checksum_delta_minor !== null && /^-?0+$/.test(run.checksum_delta_minor);
  const mismatched = scoped && !balanced;

  return (
    <section
      className={cn(
        'surface overflow-hidden',
        balanced && 'border-[var(--success-border)]',
        mismatched && 'border-[var(--danger-border)]',
      )}
    >
      <header
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3',
          balanced && 'border-[var(--success-border)] bg-[var(--success-bg)]',
          mismatched && 'border-[var(--danger-border)] bg-[var(--danger-bg)]',
          !scoped && 'border-[var(--border-subtle)] bg-[var(--bg-sunken)]',
        )}
      >
        <div className="min-w-0">
          <p className="type-label text-[var(--text-tertiary)]">
            {scoped ? 'Payout reconciliation' : 'Window reconciliation'}
          </p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
            {run.payout_id ? (
              <ObjectId id={run.payout_id} truncate={false} className="type-mono text-[var(--text-primary)]" />
            ) : (
              <span className="type-body-sm text-[var(--text-primary)]">{run.scope_type} scope</span>
            )}
            <span className="type-caption text-[var(--text-secondary)]">
              {run.account_display_name ?? run.stripe_account_id}
            </span>
          </div>
        </div>

        {scoped ? (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 type-label',
              balanced ? 'text-[var(--success-fg)]' : 'text-[var(--danger-fg)]',
            )}
          >
            <FontAwesomeIcon
              icon={balanced ? faCircleCheck : faTriangleExclamation}
              className="text-[12px]"
              aria-hidden
            />
            {balanced ? 'Balanced' : 'Mismatch'}
          </span>
        ) : (
          <span className="type-label text-[var(--text-tertiary)]">No bank deposit in scope</span>
        )}
      </header>

      <div className="px-5 py-4">
        {scoped ? (
          <dl className="ledger-strip max-w-xs">
            <dt>Payout amount</dt>
            <dd>
              <Amount minor={run.payout_amount_minor} currency={run.currency} />
            </dd>

            <dt>
              Σ balance transactions
              <span className="ml-1.5 type-caption text-[var(--text-tertiary)]">
                ({formatCount(run.balance_transaction_count)})
              </span>
            </dt>
            <dd>
              <Amount minor={run.reconstructed_minor} currency={run.currency} />
            </dd>

            <dt className="ledger-total">Difference</dt>
            <dd
              className={cn(
                'ledger-total',
                balanced ? 'text-[var(--success-fg)]' : 'text-[var(--danger-fg)]',
              )}
            >
              <Amount minor={run.checksum_delta_minor ?? '0'} currency={run.currency} />
            </dd>
          </dl>
        ) : (
          <p className="max-w-md type-body-sm text-[var(--text-secondary)]">
            A window run has no bank deposit to tie to. It reconciles money still in flight and the
            order-side rules for the whole account.
          </p>
        )}

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Fact label="Rule version" value={`v${run.rule_version}`} />
          <Fact label="Mode" value={run.mode} />
          <Fact label="Objects evaluated" value={formatCount(run.objects_evaluated)} />
          <Fact label="Triggered by" value={run.triggered_by} />
        </dl>

        {run.snapshot_checksum ? (
          <div className="mt-4 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
            <span className="type-caption text-[var(--text-tertiary)]">Snapshot checksum</span>
            <ObjectId id={run.snapshot_checksum} />
            <span className="type-caption text-[var(--text-tertiary)]">
              Re-running this scope on the same data reproduces it exactly.
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="type-caption text-[var(--text-tertiary)]">{label}</dt>
      <dd className="m-0 mt-0.5 type-body-sm text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}
