'use client';

import { useActionState, useEffect, useState, type ReactNode } from 'react';
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
  /**
   * A confirmation describes the submission that produced it, so the first edit
   * afterwards makes it untrue. Left standing, "Saved." sits above a field the
   * user has just changed and claims the change is already stored — which is
   * exactly when someone navigates away and loses it.
   *
   * The error is kept: it reports what the last attempt rejected and stays
   * useful while the field is being corrected, rather than making a claim about
   * the form's current contents.
   */
  const [edited, setEdited] = useState(false);
  useEffect(() => setEdited(false), [state]);

  return (
    <form action={submit} className={className} onChange={() => setEdited(true)}>
      {state.error && <StatusMessage tone="error" className="col-span-full mb-4">{state.error}</StatusMessage>}
      {state.success && !edited && (
        <StatusMessage tone="success" className="col-span-full mb-4">{state.success}</StatusMessage>
      )}
      {children}
    </form>
  );
}
