import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/sign-in', '/api/session'];

/**
 * Next 16 renames middleware to `proxy`. Auth gating lives here, but it is never the only check:
 * the console layout and every route handler re-validate the session on the server, because the
 * 16.x line has had a run of middleware-bypass advisories and a single gate at the edge is a
 * single point of failure.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  if (request.cookies.has('magic_session')) return NextResponse.next();

  /**
   * A data request gets a problem document; a navigation gets the sign-in page. Redirecting an
   * API call would hand a fetch client an HTML login form with a 200-shaped status, which every
   * caller then has to special-case.
   */
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      {
        type: 'https://magic.dev/problems/not-authenticated',
        title: 'Not authenticated',
        status: 401,
        detail: 'Your session has expired. Sign in again to continue.',
      },
      { status: 401, headers: { 'content-type': 'application/problem+json' } },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
