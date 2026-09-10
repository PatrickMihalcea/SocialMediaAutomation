'use client';

import { useActionState } from 'react';
import { Button, StatusMessage } from '@/bridge88/components';
import { PendingButton } from '@/components/action-ui';
import {
  connectDemoChannelAction,
  type ChannelActionState,
} from '@/app/actions/channels';

const INITIAL_STATE: ChannelActionState = {};

export function DemoChannelConnectForm({
  slug,
  platform,
  label,
}: {
  slug: string;
  platform: string;
  label: string;
}) {
  const [state, submit] = useActionState(
    connectDemoChannelAction.bind(null, slug),
    INITIAL_STATE,
  );

  return (
    <form action={submit}>
      <input type="hidden" name="platform" value={platform} />
      {state.error && (
        <StatusMessage tone="error" className="mt-4">
          <p>{state.error}</p>
          {state.billingHref && (
            <Button href={state.billingHref} variant="secondary" className="mt-3">
              Open Billing
            </Button>
          )}
        </StatusMessage>
      )}
      {state.success && <StatusMessage tone="success" className="mt-4">{state.success}</StatusMessage>}
      <PendingButton
        type="submit"
        variant="secondary"
        fullWidth
        className="mt-4"
        pendingLabel={`Connecting ${label}`}
      >
        Connect {label} demo
      </PendingButton>
    </form>
  );
}
