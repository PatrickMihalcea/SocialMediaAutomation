'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field, StatusMessage, TextArea } from '@/bridge88/components';
import {
  createWorkflowAction,
  deleteWorkflowAction,
  duplicateWorkflowAction,
  setWorkflowArchivedAction,
  updateWorkflowAction,
} from '@/app/actions/workflows';

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

/**
 * The pause switch, beside the badge that reports it.
 *
 * Living only inside the Manage dialog left the state visible and its remedy
 * hidden, which reads as a workflow that is stuck rather than one that is off.
 */
export function WorkflowPauseToggle({
  slug,
  workflowId,
  enabled,
}: {
  slug: string;
  workflowId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setError('');
          startTransition(async () => {
            try {
              await updateWorkflowAction(slug, workflowId, { enabled: !enabled });
              router.refresh();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'That workflow could not be updated.');
            }
          });
        }}
      >
        {enabled ? 'Pause schedule' : 'Resume schedule'}
      </Button>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </>
  );
}

export function WorkflowListItemActions({
  slug,
  workflow,
}: {
  slug: string;
  workflow: {
    id: string;
    name: string;
    description: string | null;
    enabled: boolean;
    archived: boolean;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description ?? '');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function perform<T>(action: () => Promise<T>, after?: (result: T) => void) {
    setError('');
    startTransition(async () => {
      try {
        const result = await action();
        after?.(result);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That workflow could not be updated.');
      }
    });
  }

  return (
    <>
      <Button variant="tertiary" onClick={() => setOpen(true)}>
        Manage
      </Button>
      <Dialog
        open={open}
        eyebrow="Workflow"
        title={confirmDelete ? `Delete ${workflow.name}?` : 'Manage workflow'}
        onClose={() => {
          if (pending) return;
          setOpen(false);
          setConfirmDelete(false);
          setError('');
        }}
        actions={confirmDelete ? (
          <>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() => perform(
                () => deleteWorkflowAction(slug, workflow.id),
                () => {
                  setOpen(false);
                  router.push(`/w/${slug}/workflows?view=archived`);
                },
              )}
            >
              {pending ? 'Deleting' : 'Delete permanently'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
            Close
          </Button>
        )}
      >
        {confirmDelete ? (
          <p className="b88-body-sm">
            This removes the workflow, its run history, and its saved graph. This cannot be undone.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="space-y-4">
              <Field
                label="Name"
                value={name}
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
              />
              <TextArea
                label="Description"
                value={description}
                rows={3}
                disabled={pending}
                onChange={(event) => setDescription(event.target.value)}
              />
              <Button
                disabled={pending || name.trim().length < 2}
                onClick={() => perform(() => updateWorkflowAction(slug, workflow.id, {
                  name,
                  description: description.trim() || null,
                }))}
              >
                Save details
              </Button>
            </div>

            <div className="border-t border-hairline-soft pt-5">
              <p className="b88-label">Actions</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => perform(
                    () => duplicateWorkflowAction(slug, workflow.id),
                    (copy) => {
                      setOpen(false);
                      router.push(`/w/${slug}/workflows/${copy.id}?view=steps`);
                    },
                  )}
                >
                  Duplicate
                </Button>
                {!workflow.archived && (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => perform(() => updateWorkflowAction(slug, workflow.id, {
                      enabled: !workflow.enabled,
                    }))}
                  >
                    {workflow.enabled ? 'Pause schedule' : 'Resume schedule'}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => perform(
                    () => setWorkflowArchivedAction(slug, workflow.id, !workflow.archived),
                    () => setOpen(false),
                  )}
                >
                  {workflow.archived ? 'Restore' : 'Archive'}
                </Button>
                {workflow.archived && (
                  <Button
                    variant="tertiary"
                    disabled={pending}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete permanently
                  </Button>
                )}
              </div>
              <p className="b88-caption mt-3">
                Pausing stops scheduled runs only. Run now still works. Duplicates start paused.
              </p>
            </div>
          </div>
        )}
        {error && <StatusMessage tone="error">{error}</StatusMessage>}
      </Dialog>
    </>
  );
}
