'use client';

import { Button, StatusMessage } from '@/bridge88/components';

export default function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section aria-labelledby="workspace-error-title">
      <StatusMessage tone="error">
        <h1 id="workspace-error-title" className="font-[480]">This workspace view could not load.</h1>
        <p className="mt-1">Your work is still saved. Try loading this view again, or return to your workspace list.</p>
      </StatusMessage>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button href="/w" variant="secondary">Choose a workspace</Button>
      </div>
    </section>
  );
}
