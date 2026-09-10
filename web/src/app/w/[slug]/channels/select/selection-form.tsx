'use client';

import { useState, useTransition } from 'react';
import { Avatar, Button, Checkbox, StatusMessage } from '@/bridge88/components';
import type { ChannelActionState } from '@/app/actions/channels';

type SelectableAccount = {
  externalAccountId: string;
  accountName: string;
  accountHandle?: string;
  avatarUrl?: string;
};

export function SelectionForm({
  accounts,
  action,
}: {
  accounts: SelectableAccount[];
  action: (previous: ChannelActionState, formData: FormData) => Promise<ChannelActionState>;
}) {
  const [state, setState] = useState<ChannelActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-8 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        if (!formData.getAll('account').length) {
          setState({ status: 'error', error: 'Select at least one account to continue.' });
          return;
        }
        setState({});
        startTransition(async () => {
          try {
            setState(await action({}, formData));
          } catch (caught) {
            setState({
              status: 'error',
              error: caught instanceof Error ? caught.message : 'The accounts could not be connected. Try again.',
            });
          }
        });
      }}
    >
      {state.error && (
        <StatusMessage tone="error">
          <p>{state.error}</p>
          {state.billingHref && (
            <Button href={state.billingHref} variant="secondary" className="mt-3">
              Open Billing
            </Button>
          )}
        </StatusMessage>
      )}
      {accounts.map((account) => (
        <div key={account.externalAccountId} className="b88-card flex items-center gap-4">
          <Checkbox
            name="account"
            value={account.externalAccountId}
            defaultChecked={accounts.length === 1}
            label={account.accountName}
            description={account.accountHandle}
            containerClassName="min-w-0 flex-1"
          />
          <Avatar name={account.accountName} src={account.avatarUrl} size={40} />
        </div>
      ))}
      <Button type="submit" className="relative mt-5" disabled={pending} aria-busy={pending}>
        Connect selected accounts
        {pending && <span className="b88-spinner-inline absolute right-1" aria-hidden />}
      </Button>
    </form>
  );
}
