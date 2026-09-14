'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/bridge88/components';
import { runWorkflowAction } from '@/app/actions/workflows';

/** Starts a run and goes straight to it, the way a "Run now" control should. */
export function RunWorkflowButton({
  slug,
  workflowId,
  disabled,
}: {
  slug: string;
  workflowId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={pending || disabled}
        onClick={() =>
          startTransition(async () => {
            setError('');
            try {
              const { runId } = await runWorkflowAction(slug, workflowId);
              router.push(`/w/${slug}/workflows/${workflowId}/runs/${runId}`);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'That workflow could not start.');
            }
          })
        }
      >
        {pending ? 'Starting' : 'Run now'}
      </Button>
      {error && (
        <span className="b88-body-sm max-w-xs text-right" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
