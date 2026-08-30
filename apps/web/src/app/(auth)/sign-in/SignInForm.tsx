'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@/shared/components/ui/Button';
import { apiFetch } from '@/shared/lib/client';

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await apiFetch('/api/session', { method: 'POST', body: { email, password } });
      router.push('/');
      router.refresh();
    } catch (caught) {
      /**
       * One message for a wrong password and for an address that does not exist. Distinguishing
       * them turns this form into an account-enumeration oracle.
       */
      setError(caught instanceof Error ? caught.message : 'Those credentials are not correct.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-4" noValidate>
      <div>
        <label htmlFor="email" className="type-label text-[var(--text-secondary)]">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 type-body focus:border-[var(--border-focus)] focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="password" className="type-label text-[var(--text-secondary)]">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 type-body focus:border-[var(--border-focus)] focus:outline-none"
        />
      </div>

      {error ? (
        <p role="alert" className="flex items-start gap-2 type-body-sm text-[var(--danger-fg)]">
          <FontAwesomeIcon icon={faCircleExclamation} className="mt-0.5 text-[12px]" aria-hidden />
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" loading={submitting} className="mt-1 w-full">
        Sign in
      </Button>
    </form>
  );
}
