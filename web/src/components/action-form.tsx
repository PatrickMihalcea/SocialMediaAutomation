'use client';

import { useActionState, type ReactNode } from 'react';
import { StatusMessage } from '@/bridge88/components';
import type { ActionState } from '@/lib/actions/state';

export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, submit] = useActionState(action, {});
  return (
    <form action={submit} className={className}>
      {state.error && <StatusMessage tone="error" className="col-span-full mb-4">{state.error}</StatusMessage>}
      {state.success && <StatusMessage tone="success" className="col-span-full mb-4">{state.success}</StatusMessage>}
      {children}
    </form>
  );
}
