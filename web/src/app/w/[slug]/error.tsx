'use client';

import { Button, StatusMessage } from '@/bridge88/components';

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section aria-labelledby="workspace-error-title">
      <StatusMessage tone="error">
        <h1 id="workspace-error-title" className="font-[480]">This workspace view could not load.</h1>
        <p className="mt-1">Try again. Reference {error.digest ?? 'unknown'} if the problem continues.</p>
      </StatusMessage>
      <Button className="mt-5" onClick={reset}>Try again</Button>
    </section>
  );
}
