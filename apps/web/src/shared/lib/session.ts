import 'server-only';
import { cookies } from 'next/headers';
import Redis from 'ioredis';
import { newCsrfToken, newSessionId, signValue, verifySigned } from '@magic/security';
import type { SessionPayload } from '@magic/contracts';
import { serverEnv } from './env';

export const SESSION_COOKIE = 'magic_session';
export const CSRF_COOKIE = 'magic_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface StoredSession extends SessionPayload {
  readonly issuedAt: number;
  readonly lastSeenAt: number;
}

let client: Redis | null = null;

function redis(): Redis {
  client ??= new Redis(serverEnv().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  return client;
}

function key(id: string): string {
  return `magic:session:${id}`;
}

/**
 * Sessions are server-side and the cookie carries only a signed opaque identifier.
 *
 * There is no access token in the browser because there is no token in the browser at all — the
 * single most effective mitigation available against a cross-site scripting bug, since it removes
 * the asset rather than defending it. Revocation is a delete, not a wait for expiry.
 */
export async function createSession(payload: SessionPayload): Promise<{ sessionId: string; csrfToken: string }> {
  const env = serverEnv();
  const sessionId = newSessionId();
  const csrfToken = newCsrfToken();
  const now = Date.now();

  const stored: StoredSession = { ...payload, issuedAt: now, lastSeenAt: now };

  await redis().set(
    key(sessionId),
    JSON.stringify({ ...stored, csrfToken }),
    'EX',
    env.SESSION_ABSOLUTE_HOURS * 3600,
  );

  const store = await cookies();
  const secure = env.NODE_ENV === 'production';

  store.set(SESSION_COOKIE, signValue(sessionId, env.SESSION_SECRET), {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_ABSOLUTE_HOURS * 3600,
  });

  /** Readable by script on purpose: the double-submit token must be echoed in a header. */
  store.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_ABSOLUTE_HOURS * 3600,
  });

  return { sessionId, csrfToken };
}

export async function readSession(): Promise<(StoredSession & { csrfToken: string }) | null> {
  const env = serverEnv();
  const store = await cookies();
  const signed = store.get(SESSION_COOKIE)?.value;
  if (!signed) return null;

  const sessionId = verifySigned(signed, env.SESSION_SECRET);
  if (!sessionId) return null;

  const raw = await redis().get(key(sessionId));
  if (!raw) return null;

  const session = JSON.parse(raw) as StoredSession & { csrfToken: string };
  const now = Date.now();

  if (now - session.lastSeenAt > env.SESSION_IDLE_MINUTES * 60_000) {
    await redis().del(key(sessionId));
    return null;
  }

  if (now - session.issuedAt > env.SESSION_ABSOLUTE_HOURS * 3_600_000) {
    await redis().del(key(sessionId));
    return null;
  }

  const touched = { ...session, lastSeenAt: now };
  await redis().set(key(sessionId), JSON.stringify(touched), 'KEEPTTL');

  return touched;
}

/** Rotation on privilege change. A tenant switch is a privilege change. */
export async function rotateSession(payload: SessionPayload): Promise<void> {
  await destroySession();
  await createSession(payload);
}

export async function destroySession(): Promise<void> {
  const env = serverEnv();
  const store = await cookies();
  const signed = store.get(SESSION_COOKIE)?.value;

  if (signed) {
    const sessionId = verifySigned(signed, env.SESSION_SECRET);
    if (sessionId) await redis().del(key(sessionId));
  }

  store.delete(SESSION_COOKIE);
  store.delete(CSRF_COOKIE);
}
