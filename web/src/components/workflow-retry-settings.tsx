'use client';

import { useState, useTransition } from 'react';
import { Slider, StatusMessage, Switch } from '@/bridge88/components';
import { updateWorkflowAction } from '@/app/actions/workflows';

/**
 * Whether a failed run starts a fresh one by itself.
 *
 * Saved as it changes, like the step settings, so there is no Save to forget.
 * The limit is a count of retries in a row from the run that first failed: a
 * workflow that fails every time stops after that many rather than looping.
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
        label="Start again when a run fails"
        description={pending ? 'Saving' : undefined}
        checked={enabled}
        onChange={(next) => {
          setEnabled(next);
          save({ retryFailedRuns: next });
        }}
      />
      {enabled && (
        <Slider
          label="Times in a row"
          hint="How many fresh runs to start after a failure before giving up. A cancelled run is never started again."
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
