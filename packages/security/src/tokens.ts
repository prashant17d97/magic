import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque session identifiers rather than JWTs. Nothing in the browser carries authority on its
 * own: the cookie holds a random identifier, the server holds the session, and revocation is a
 * delete rather than a wait for expiry.
 */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function signValue(value: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${signature}`;
}

export function verifySigned(signed: string, secret: string): string | null {
  const separator = signed.lastIndexOf('.');
  if (separator <= 0) return null;

  const value = signed.slice(0, separator);
  const provided = signed.slice(separator + 1);
  const expected = createHmac('sha256', secret).update(value).digest('base64url');

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? value : null;
}

/** Double-submit CSRF token. Guards every state-changing request from the browser. */
export function newCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

export function csrfMatches(cookieToken: string | undefined, headerToken: string | undefined): boolean {
  if (!cookieToken || !headerToken) return false;
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
