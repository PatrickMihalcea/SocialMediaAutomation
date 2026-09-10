'use client';

import { useState, useTransition } from 'react';
import { Button, Field, Select, StatusMessage } from '@/bridge88/components';
import { inviteMemberAction } from '@/app/actions/team';

export function InviteForm({ slug }: { slug: string }) {
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="self-start rounded-lg bg-[var(--block-lilac)] p-6"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        setMessage(undefined);
        startTransition(async () => {
          const result = await inviteMemberAction(slug, new FormData(form));
          if (result.error) {
            setMessage({ tone: 'error', text: result.error });
            return;
          }
          setMessage({ tone: 'success', text: result.success ?? 'Invitation created.' });
          form.reset();
        });
      }}
    >
      <p className="b88-caption">Invite member</p>
      <h2 className="b88-heading mt-2">Add a collaborator</h2>
      <p className="mt-2 text-sm">The invitation expires after seven days. You can resend or cancel it from the member list.</p>
      {message && <StatusMessage tone={message.tone} className="mt-5">{message.text}</StatusMessage>}
      <Field name="email" label="Email" type="email" containerClassName="mt-5" required />
      <Select name="role" label="Role" containerClassName="mt-4" defaultValue="EDITOR">
        <option value="EDITOR">Editor</option>
        <option value="VIEWER">Viewer</option>
        <option value="ADMIN">Admin</option>
      </Select>
      <Button type="submit" className="relative mt-5" disabled={pending} aria-busy={pending}>
        Create invitation
        {pending && <span className="b88-spinner-inline" aria-hidden />}
      </Button>
    </form>
  );
}
