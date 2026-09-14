import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth/config';

/**
 * Edge middleware only answers "is there a session cookie" — workspace access is
 * decided in src/lib/auth/guard.ts where the database is reachable.
 */
const { auth } = NextAuth(authConfig);

const PUBLIC_PREFIXES = ['/login', '/signup', '/forgot-password', '/reset-password', '/verify-email', '/invite'];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const signedIn = Boolean(req.auth?.user);

  if (pathname === '/' || pathname.startsWith('/pricing')) return NextResponse.next();

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (signedIn && pathname !== '/invite') {
      return NextResponse.redirect(new URL('/w', req.nextUrl.origin));
    }
    return NextResponse.next();
  }

  if (!signedIn) {
    const url = new URL('/login', req.nextUrl.origin);
    url.searchParams.set('next', pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  // Every /api route is excluded, not just a handful.
  //
  // Two reasons. Each route handler authenticates itself through requireUser or
  // requireWorkspace, so middleware adds nothing but a redirect an API client
  // cannot use — a 307 to /login instead of a 401. And middleware buffers a
  // clone of the request body, capped by experimental.middlewareClientMaxBodySize
  // at 10 MiB, which silently truncated every media upload past that size.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|txt)$).*)'],
};
