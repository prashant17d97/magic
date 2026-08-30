import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { csrfMatches } from '@magic/security';
import { serverEnv } from './env';
import { CSRF_COOKIE, CSRF_HEADER, readSession } from './session';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function problem(status: number, title: string, detail: string): NextResponse {
  return NextResponse.json(
    { type: `https://magic.dev/problems/${title.toLowerCase().replace(/\s+/g, '-')}`, title, status, detail },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

/**
 * The single path from the browser to the API.
 *
 * Tenant, role and account scope are attached here from the server-side session and are never
 * read from the request. The browser can ask for a filtered list; it cannot ask to be a different
 * tenant, because the parameter that decides that does not travel with the request.
 */
export async function proxyToApi(
  request: NextRequest,
  path: string,
  init: { method?: string; body?: unknown; search?: URLSearchParams } = {},
): Promise<NextResponse> {
  const session = await readSession();
  if (!session) return problem(401, 'Not authenticated', 'Sign in to continue.');

  const method = init.method ?? request.method;

  if (MUTATING.has(method)) {
    const headerToken = request.headers.get(CSRF_HEADER) ?? undefined;
    const cookieToken = request.cookies.get(CSRF_COOKIE)?.value;
    if (!csrfMatches(cookieToken, headerToken)) {
      return problem(403, 'CSRF check failed', 'This request is missing a valid CSRF token.');
    }
  }

  const env = serverEnv();
  const search = init.search ?? request.nextUrl.searchParams;
  const query = search.toString();
  const url = `${env.API_INTERNAL_URL}${path}${query ? `?${query}` : ''}`;

  const headers: Record<string, string> = {
    'x-service-token': env.SERVICE_TOKEN,
    'x-magic-tenant-id': session.tenant.id,
    'x-magic-role': session.role,
    'content-type': 'application/json',
  };

  if (session.user.id) headers['x-magic-user-id'] = session.user.id;
  if (session.account_scope?.length) headers['x-magic-account-scope'] = session.account_scope.join(',');

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;

  const userAgent = request.headers.get('user-agent');
  if (userAgent) headers['user-agent'] = userAgent;

  const body = init.body !== undefined ? JSON.stringify(init.body) : method !== 'GET' ? await safeBody(request) : undefined;

  try {
    const response = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      cache: 'no-store',
    });

    const text = await response.text();
    return new NextResponse(text || null, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    /** The API being unreachable is a delay, never a data problem, and the copy says so. */
    return problem(503, 'Service unavailable', 'The reconciliation service is not responding. Your data is unaffected.');
  }
}

async function safeBody(request: NextRequest): Promise<string | undefined> {
  try {
    const text = await request.text();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Server Component data access. Same header discipline as the proxy, used to render the first
 * page on the server so the operator sees rows in the first paint rather than a spinner.
 */
export async function fetchFromApi<T>(path: string, search?: Record<string, unknown>): Promise<T> {
  const session = await readSession();
  if (!session) throw new Error('UNAUTHENTICATED');

  const env = serverEnv();
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(search ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.set(key, String(value));
    }
  }

  const query = params.toString();
  const headers: Record<string, string> = {
    'x-service-token': env.SERVICE_TOKEN,
    'x-magic-tenant-id': session.tenant.id,
    'x-magic-role': session.role,
    'content-type': 'application/json',
  };

  if (session.user.id) headers['x-magic-user-id'] = session.user.id;
  if (session.account_scope?.length) headers['x-magic-account-scope'] = session.account_scope.join(',');

  const response = await fetch(`${env.API_INTERNAL_URL}${path}${query ? `?${query}` : ''}`, {
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`API ${response.status} for ${path}: ${detail.slice(0, 300)}`);
  }

  return (await response.json()) as T;
}
