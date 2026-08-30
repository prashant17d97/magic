'use client';

import type { Problem } from '@magic/contracts';

export class ApiError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.problem = problem;
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)magic_csrf=([^;]+)/);
  return match?.[1] ?? '';
}

/**
 * The client half of the double-submit CSRF pair: the token is read from a cookie the server set
 * and echoed in a header. A cross-site form post can carry the cookie but cannot read it, so it
 * cannot produce the header.
 */
export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { 'content-type': 'application/json' };

  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();

  const response = await fetch(path, {
    method,
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    ...(init.signal ? { signal: init.signal } : {}),
    credentials: 'same-origin',
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    throw new ApiError(
      (payload as Problem | null) ?? {
        type: 'https://magic.dev/problems/unknown',
        title: 'Request failed',
        status: response.status,
      },
    );
  }

  return payload as T;
}

export function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item !== undefined && item !== null && item !== '') search.append(key, String(item));
    } else {
      search.set(key, String(value));
    }
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}
