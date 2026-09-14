'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, StatusMessage } from '@/bridge88/components';
import { createWorkflowAction } from '@/app/actions/workflows';

export function NewWorkflowForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function submit() {
    setError('');
    startTransition(async () => {
      try {
        const workflow = await createWorkflowAction(slug, { name });
        router.push(`/w/${slug}/workflows/${workflow.id}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That workflow could not be created.');
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New workflow</Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-hairline p-6">
      <p className="b88-eyebrow">New workflow</p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div className="min-w-64 flex-1">
          <Field
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Bedroom picker"
            autoFocus
          />
        </div>
        <Button onClick={submit} disabled={pending || name.trim().length < 2}>
          {pending ? 'Creating' : 'Create'}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </div>
  );
}
