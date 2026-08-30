import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { csrfMatches } from '@magic/security';
import type { SessionPayload } from '@magic/contracts';
import { serverEnv } from '@/shared/lib/env';
import { CSRF_COOKIE, CSRF_HEADER, readSession, rotateSession } from '@/shared/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ tenant_id: z.string().uuid() });

/**
 * Switching workspace rotates the session identifier.
 *
 * A privilege change that keeps its old identifier leaves a token that was minted under different
 * authority still valid, which is the shape of most session-fixation bugs.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await readSession();
  if (!session) return NextResponse.json({ title: 'Not authenticated', status: 401 }, { status: 401 });

  const headerToken = request.headers.get(CSRF_HEADER) ?? undefined;
  const cookieToken = request.cookies.get(CSRF_COOKIE)?.value;
  if (!csrfMatches(cookieToken, headerToken)) {
    return NextResponse.json({ title: 'CSRF check failed', status: 403 }, { status: 403 });
  }

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ title: 'Bad request', status: 400 }, { status: 400 });
  }

  const allowed = session.available_tenants.some((tenant) => tenant.id === parsed.data.tenant_id);
  if (!allowed) {
    return NextResponse.json({ title: 'Not permitted', status: 403 }, { status: 403 });
  }

  const env = serverEnv();
  const response = await fetch(`${env.API_INTERNAL_URL}/v1/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-service-token': env.SERVICE_TOKEN },
    body: JSON.stringify({ user_id: session.user.id, tenant_id: parsed.data.tenant_id }),
    cache: 'no-store',
  });

  if (!response.ok) {
    return NextResponse.json({ title: 'Not permitted', status: 403 }, { status: 403 });
  }

  const next = (await response.json()) as SessionPayload;
  await rotateSession(next);

  return NextResponse.json({ tenant: next.tenant, role: next.role });
}
