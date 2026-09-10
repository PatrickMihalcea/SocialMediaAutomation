'use client';

import { useFormStatus } from 'react-dom';
import { useState, useTransition, type ComponentProps } from 'react';
import { Button, Field, StatusMessage } from '@/bridge88/components';
import { inviteMemberAction } from '@/app/actions/team';

// Absolutely positioned so entering the pending state leaves the button's
// measured width and height untouched; it sits in the 16px inline padding.
function PendingSpinner({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center">
      <span className="b88-spinner-inline" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PendingButton({
  children,
  pendingLabel = 'Saving',
  className = '',
  ...props
}: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      {...props}
      className={`relative ${className}`}
      disabled={pending || props.disabled}
      aria-busy={pending}
    >
      {children}
      {pending && <PendingSpinner label={pendingLabel} />}
    </Button>
  );
}

export function ConfirmationButton({
  confirmMessage,
  pendingLabel = 'Working',
  children,
  className = '',
  ...props
}: ComponentProps<typeof Button> & { confirmMessage: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      {...props}
      className={`relative ${className}`}
      type={props.type ?? 'submit'}
      disabled={pending || props.disabled}
      aria-busy={pending}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
        props.onClick?.(event);
      }}
    >
      {children}
      {pending && <PendingSpinner label={pendingLabel} />}
    </Button>
  );
}

export function InviteForm({ slug }: { slug: string }) {
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="rounded-lg bg-[var(--block-lilac)] p-6 self-start"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        setMessage(undefined);
        startTransition(async () => {
          try {
            const result: unknown = await inviteMemberAction(slug, formData);
            const returned = result as { success?: string; error?: string } | undefined;
            if (returned?.error) {
              setMessage({ tone: 'error', text: returned.error });
              return;
            }
            setMessage({
              tone: 'success',
              text: returned?.success ?? 'Invitation created and sent by email.',
            });
            form.reset();
          } catch (error) {
            setMessage({
              tone: 'error',
              text: error instanceof Error ? error.message : 'The invitation could not be created.',
            });
          }
        });
      }}
    >
      <p className="b88-caption">Invite member</p>
      <h2 className="b88-heading mt-2">Add a collaborator</h2>
      {message && <StatusMessage tone={message.tone} className="mt-5">{message.text}</StatusMessage>}
      <div className="mt-5"><Field name="email" label="Email" type="email" required /></div>
      <label className="mt-4 block">
        <span className="b88-label">Role</span>
        <select name="role" className="b88-input">
          <option value="EDITOR">Editor</option>
          <option value="VIEWER">Viewer</option>
          <option value="ADMIN">Admin</option>
        </select>
      </label>
      <Button type="submit" className="relative mt-5" disabled={pending} aria-busy={pending}>
        Create invitation
        {pending && <PendingSpinner label="Creating invitation" />}
      </Button>
    </form>
  );
}
