'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/bridge88/components';
import { cancelJobAction, retryJobAction } from '@/app/actions/admin';

export function AdminJobActions({ id, status }: { id: string; status: string }) {
  if (['FAILED', 'CANCELLED'].includes(status)) {
    return <form action={retryJobAction.bind(null, id)}><ActionButton idle="Retry" pending="Retrying" /></form>;
  }
  if (['QUEUED', 'RUNNING'].includes(status)) {
    return (
      <form
        action={cancelJobAction.bind(null, id)}
        onSubmit={(event) => {
          if (!window.confirm('Cancel this job? Work already sent to an external service may still finish.')) event.preventDefault();
        }}
      >
        <ActionButton idle="Cancel" pending="Cancelling" />
      </form>
    );
  }
  return <span aria-hidden="true">—</span>;
}

function ActionButton({ idle, pending }: { idle: string; pending: string }) {
  const { pending: isPending } = useFormStatus();
  return <Button type="submit" variant="tertiary" disabled={isPending} className="min-w-[92px]">{isPending ? pending : idle}</Button>;
}
