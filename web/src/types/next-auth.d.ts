import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: { id: string; isPlatformAdmin: boolean } & DefaultSession['user'];
  }
  interface User {
    isPlatformAdmin?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    isPlatformAdmin?: boolean;
  }
}
