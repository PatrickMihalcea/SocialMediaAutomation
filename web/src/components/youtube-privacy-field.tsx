'use client';

import { useState, useTransition } from 'react';
import { Dropdown, StatusMessage } from '@/bridge88/components';
import { setYoutubePrivacyAction } from '@/app/actions/channels';

const OPTIONS = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
];

/**
 * Visibility for one channel's uploads.
 *
 * Saves on change rather than behind a button: it is a single choice on a card
 * that has no other form, and a Save nobody notices is a setting that silently
 * did not apply.
 *
 * The chosen value is held locally so the control moves the moment it is
 * clicked. The server is the authority — a refused save puts it back.
 */
export function YoutubePrivacyField({
  slug,
  accountId,
  value,
  disabled,
}: {
  slug: string;
  accountId: string;
  value: string;
  disabled: boolean;
}) {
  const [chosen, setChosen] = useState(value);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <Dropdown
        label="Upload visibility"
        value={chosen}
        options={OPTIONS}
        disabled={disabled || pending}
        onChange={(next) => {
          const previous = chosen;
          setChosen(next);
          setError('');
          startTransition(async () => {
            const form = new FormData();
            form.set('privacyStatus', next);
            try {
              await setYoutubePrivacyAction(slug, accountId, form);
            } catch (cause) {
              setChosen(previous);
              setError(cause instanceof Error ? cause.message : 'That could not be saved.');
            }
          });
        }}
      />
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </div>
  );
}
