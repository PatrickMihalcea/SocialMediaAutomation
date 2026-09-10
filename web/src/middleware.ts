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
  matcher: ['/((?!api/auth|api/webhooks|api/health|api/storage|api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|txt)$).*)'],
};
