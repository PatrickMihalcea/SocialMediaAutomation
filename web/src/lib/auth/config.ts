import type { NextAuthConfig } from 'next-auth';

/**
 * The half of the Auth.js config that must stay edge-safe: no Prisma, no bcrypt.
 * The middleware imports this file; the full config (providers with database
 * access) lives in src/auth.ts and runs on Node.
 */
export const authConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
    verifyRequest: '/verify-email',
  },
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.isPlatformAdmin = (user as { isPlatformAdmin?: boolean }).isPlatformAdmin ?? false;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.isPlatformAdmin = Boolean(token.isPlatformAdmin);
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
