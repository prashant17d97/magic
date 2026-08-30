import { NextResponse, type NextRequest } from 'next/server';
import { SignInSchema, type SessionPayload } from '@magic/contracts';
import { serverEnv } from '@/shared/lib/env';
import { createSession, destroySession, readSession } from '@/shared/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Credentials are posted here and never travel further towards the browser. The API verifies
 * them, this handler establishes a server-side session, and what goes back is a cookie holding an
 * opaque identifier.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = serverEnv();

  let parsed;
  try {
    parsed = SignInSchema.parse(await request.json());
  } catch {
    return problem(400, 'Bad request', 'Enter an email address and a password.');
  }

  const response = await fetch(`${env.API_INTERNAL_URL}/v1/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-service-token': env.SERVICE_TOKEN },
    body: JSON.stringify(parsed),
    cache: 'no-store',
  });

  if (!response.ok) {
    return problem(401, 'Not authenticated', 'Those credentials are not correct.');
  }

  const session = (await response.json()) as SessionPayload;
  await createSession(session);

  return NextResponse.json({ tenant: session.tenant, role: session.role });
}

export async function DELETE(): Promise<NextResponse> {
  await destroySession();
  return new NextResponse(null, { status: 204 });
}

export async function GET(): Promise<NextResponse> {
  const session = await readSession();
  if (!session) return problem(401, 'Not authenticated', 'Sign in to continue.');

  return NextResponse.json({
    user: session.user,
    tenant: session.tenant,
    role: session.role,
    permissions: session.permissions,
    account_scope: session.account_scope,
    available_tenants: session.available_tenants,
  });
}

function problem(status: number, title: string, detail: string): NextResponse {
  return NextResponse.json(
    { type: `https://magic.dev/problems/${title.toLowerCase().replace(/\s+/g, '-')}`, title, status, detail },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}
