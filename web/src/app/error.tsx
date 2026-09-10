'use client';

import { Button, StatusMessage } from '@/bridge88/components';

export default function RootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-12 md:px-12" tabIndex={-1}>
      <StatusMessage tone="error">
        <p className="font-[480]">Bridge88 could not load this page.</p>
        <p className="mt-1">Your work is still saved. Try loading the page again, or return to the home page.</p>
      </StatusMessage>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button className="w-full sm:w-auto" onClick={reset}>Try again</Button>
        <Button className="w-full sm:w-auto" href="/" variant="secondary">Go to Bridge88</Button>
      </div>
    </main>
  );
}
