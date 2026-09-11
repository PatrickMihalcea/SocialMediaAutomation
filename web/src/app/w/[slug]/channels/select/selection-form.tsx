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
  single = false,
}: {
  accounts: SelectableAccount[];
  action: (previous: ChannelActionState, formData: FormData) => Promise<ChannelActionState>;
  single?: boolean;
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
          setState({ status: 'error', error: `Select ${single ? 'one' : 'at least one'} account to continue.` });
          return;
        }
        if (single && formData.getAll('account').length !== 1) {
          setState({ status: 'error', error: 'Select one account to reconnect.' });
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
              Open billing
            </Button>
          )}
        </StatusMessage>
      )}
      {accounts.map((account) => (
        <div
          key={account.externalAccountId}
          className="b88-card flex min-w-0 items-center gap-4 [&_label>span]:min-w-0 [&_label>span>span]:truncate [&_label>span>span]:whitespace-nowrap"
          title={[account.accountName, account.accountHandle].filter(Boolean).join(' · ')}
        >
          <Checkbox
            name="account"
            value={account.externalAccountId}
            defaultChecked={accounts.length === 1}
            label={account.accountName}
            description={account.accountHandle}
            containerClassName="min-w-0 flex-1"
            onChange={single ? (event) => {
              if (!event.currentTarget.checked) return;
              const form = event.currentTarget.form;
              form?.querySelectorAll<HTMLInputElement>('input[name="account"]').forEach((input) => {
                if (input !== event.currentTarget) input.checked = false;
              });
            } : undefined}
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
