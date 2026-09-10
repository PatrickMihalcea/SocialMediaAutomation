'use client';

import { useActionState, type ReactNode } from 'react';
import { StatusMessage } from '@/bridge88/components';
import type { ActionState } from '@/lib/actions/state';

export function ActionForm({
  action,
  children,
  className,
  encType,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  encType?: 'multipart/form-data';
}) {
  const [state, submit] = useActionState(action, {});
  return (
    <form action={submit} className={className} encType={encType}>
      {state.error && <StatusMessage tone="error" className="mb-4">{state.error}</StatusMessage>}
      {state.success && <StatusMessage tone="success" className="mb-4">{state.success}</StatusMessage>}
      {children}
    </form>
  );
}
