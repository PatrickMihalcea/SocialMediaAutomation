import type { Metadata } from 'next';
import '@/bridge88/bridge88.css';
import './globals.css';
import { AppProviders } from '@/app/providers';
import { auth } from '@/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: { default: 'Bridge88', template: '%s · Bridge88' },
  description: 'Plan, review and publish social content from one workspace.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  const preference = session?.user?.id
    ? await db.user.findUnique({ where: { id: session.user.id }, select: { themePreference: true } })
    : null;
  // Rows may still hold the retired SYSTEM value; anything but DARK renders light.
  const theme = preference?.themePreference === 'DARK' ? 'dark' : 'light';
  return (
    <html lang="en" data-theme={theme}>
      <body>
        <a href="#main-content" className="b88-skip-link">Skip to content</a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
