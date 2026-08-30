import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readSession } from '@/shared/lib/session';
import { SignInForm } from './SignInForm';
import { Wordmark } from '@/shared/components/ui/Wordmark';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/**
 * The sign-in surface states what the product asserts rather than what it sells.
 *
 * The five claims are the ones the architecture is built to keep, and an operator about to trust
 * this tool with a discrepancy should be able to read them before they type a password.
 */
const CLAIMS = [
  ['No event is ever dropped', 'Webhooks, a cursor-based sweep, and a daily count that proves it.'],
  ['Reconciliation is deterministic', 'Same inputs and rule version, byte-identical findings. Checked in CI.'],
  ['Every flag is explainable', 'Inputs, expected against actual, and the rule version that produced it.'],
  ['Tenants cannot see each other', 'Enforced in the database, not just in the application.'],
];

export default async function SignInPage() {
  const session = await readSession();
  if (session) redirect('/');

  return (
    <main className="grid h-dvh grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Wordmark />
          <h1 className="type-h1 mt-6 text-[var(--text-primary)]">Sign in</h1>
          <p className="mt-1.5 type-body-sm text-[var(--text-secondary)]">
            Reconciliation console for Stripe Connect platforms.
          </p>

          <SignInForm />
        </div>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:flex lg:items-center">
        {/*
          The ledger rule is drawn rather than illustrated. A stock image would say nothing about
          this product; a column of aligned figures under a subtotal rule is what the work looks
          like, and it is the same device the run receipt uses.
        */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to bottom, transparent, transparent 39px, var(--border-subtle) 39px, var(--border-subtle) 40px)',
          }}
          aria-hidden
        />

        <div className="relative z-10 px-12 py-16">
          <p className="type-label text-[var(--text-tertiary)]">What this system asserts</p>

          <dl className="mt-6 flex max-w-md flex-col gap-5">
            {CLAIMS.map(([claim, proof]) => (
              <div key={claim}>
                <dt className="type-h3 text-[var(--text-primary)]">{claim}</dt>
                <dd className="m-0 mt-1 type-body-sm text-[var(--text-secondary)]">{proof}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 max-w-md border-t border-[var(--border-strong)] pt-4">
            <dl className="ledger-strip">
              <dt>Payout amount</dt>
              <dd className="text-[var(--text-primary)]">$18,402.00</dd>
              <dt>Σ balance transactions</dt>
              <dd className="text-[var(--text-primary)]">$18,402.00</dd>
              <dt className="ledger-total">Difference</dt>
              <dd className="ledger-total text-[var(--success-fg)]">$0.00</dd>
            </dl>
            <p className="mt-2 type-caption text-[var(--text-tertiary)]">
              A balanced payout, which is what most of them are.
            </p>
          </div>
        </div>
      </aside>
    </main>
  );
}
