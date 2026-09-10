'use client';

import { Button, StatusMessage } from '@/bridge88/components';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-12 md:px-12" tabIndex={-1}>
      <StatusMessage tone="error">
        <p className="font-[480]">Bridge88 could not load this page.</p>
        <p className="mt-1">Try again. If the problem continues, use reference {error.digest ?? 'unknown'}.</p>
      </StatusMessage>
      <Button className="mt-6 w-full sm:w-auto" onClick={reset}>Try again</Button>
    </main>
  );
}
