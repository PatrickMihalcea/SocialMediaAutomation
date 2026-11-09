'use client';

import { useState, useTransition } from 'react';
import { Slider, StatusMessage, Switch } from '@/bridge88/components';
import { updateWorkflowAction } from '@/app/actions/workflows';

/**
 * Whether a failed run starts itself over from the first step.
 *
 * Saved as it changes, like the step settings, so there is no Save to forget.
 * The limit is how many times one run may start over: a run that fails every
 * time stops after that many rather than looping.
 */
export function WorkflowRetrySettings({
  slug,
  workflow,
}: {
  slug: string;
  workflow: { id: string; retryFailedRuns: boolean; retryLimit: number };
}) {
  const [enabled, setEnabled] = useState(workflow.retryFailedRuns);
  const [limit, setLimit] = useState(workflow.retryLimit);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function save(next: { retryFailedRuns?: boolean; retryLimit?: number }) {
    setError('');
    startTransition(async () => {
      try {
        await updateWorkflowAction(slug, workflow.id, next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That setting could not be saved.');
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="b88-eyebrow">Failed runs</p>
      <Switch
        label="Restart a failed run from the beginning"
        description={pending ? 'Saving' : undefined}
        checked={enabled}
        onChange={(next) => {
          setEnabled(next);
          save({ retryFailedRuns: next });
        }}
      />
      {enabled && (
        <Slider
          label="Restarts allowed"
          hint="How many times a run may start over from its first step before it is left failed. A cancelled run is never restarted."
          min={1}
          max={5}
          step={1}
          defaultValue={limit}
          minLabel="1"
          maxLabel="5"
          onChange={(event) => setLimit(Number(event.target.value))}
          onPointerUp={() => save({ retryLimit: limit })}
          onKeyUp={() => save({ retryLimit: limit })}
        />
      )}
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </div>
  );
}
