'use client';

import { useState, useTransition } from 'react';
import { Avatar, Button, Checkbox, StatusMessage } from '@/bridge88/components';

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
  action: (formData: FormData) => Promise<void>;
}) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-8 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        if (!formData.getAll('account').length) {
          setError('Select at least one account to continue.');
          return;
        }
        setError(undefined);
        startTransition(async () => {
          try {
            await action(formData);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'The accounts could not be connected. Try again.');
          }
        });
      }}
    >
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
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
