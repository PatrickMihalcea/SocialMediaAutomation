import type { Metadata } from 'next';
import '@/bridge88/bridge88.css';
import './globals.css';
import { AppProviders } from '@/app/providers';

export const metadata: Metadata = {
  title: { default: 'Bridge88', template: '%s · Bridge88' },
  description: 'Plan, review and publish social content from one workspace.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="b88-skip-link">Skip to content</a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
