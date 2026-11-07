'use client';

import { useEffect, useState } from 'react';
import { Avatar, Checkbox, Select, StatusMessage } from '@/bridge88/components';
import { getTikTokCreatorInfoAction } from '@/app/actions/channels';
import {
  TIKTOK_PRIVACY_LABELS,
  tiktokDeclaration,
  tiktokOptionsProblem,
  type TikTokCreatorInfo,
  type TikTokPostOptions,
} from '@/lib/social/tiktok-options';

/**
 * The choices TikTok requires before every post.
 *
 * Follows TikTok's Direct Post rules: the account's own name is shown, who can
 * see the post starts unchosen, interactions start off and stay off where the
 * account has turned them off, and the consent line sits above the post
 * button. The account's options are fetched each time, as TikTok asks.
 */
export function TikTokPostSettings({
  slug,
  accountId,
  options,
  onChange,
  disabled,
}: {
  slug: string;
  accountId: string;
  options: TikTokPostOptions;
  onChange: (next: TikTokPostOptions) => void;
  disabled?: boolean;
}) {
  const [creator, setCreator] = useState<TikTokCreatorInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCreator(null);
    setError(null);
    void getTikTokCreatorInfoAction(slug, accountId).then((result) => {
      if (cancelled) return;
      if (result.ok) setCreator(result.info);
      else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, accountId]);

  const set = (patch: Partial<TikTokPostOptions>) => onChange({ ...options, ...patch });
  const problem = tiktokOptionsProblem(options);
  // Branded content cannot be private, so "Only me" leaves the list while it is on.
  const privacyLevels = (creator?.privacyLevels ?? []).filter(
    (level) => !(options.commercial && options.brandedContent && level === 'SELF_ONLY'),
  );

  return (
    <section aria-labelledby={`tiktok-settings-${accountId}`} className="grid gap-4">
      <p id={`tiktok-settings-${accountId}`} className="b88-label">TikTok settings</p>

      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {!error && !creator && <StatusMessage>Checking what this TikTok account can post…</StatusMessage>}

      {creator && (
        <>
          <div className="flex items-center gap-3">
            <Avatar name={creator.nickname} src={creator.avatarUrl} />
            <p className="text-sm">
              Posting to <strong>{creator.nickname}</strong>
              {creator.username && <> · @{creator.username}</>}
            </p>
          </div>

          <Select
            label="Who can see this video"
            value={options.privacyLevel ?? ''}
            disabled={disabled}
            onChange={(event) =>
              set({ privacyLevel: (event.target.value || null) as TikTokPostOptions['privacyLevel'] })
            }
            hint={
              options.commercial && options.brandedContent
                ? 'Branded content cannot be private.'
                : creator.maxVideoSeconds
                  ? `This account can post videos up to ${creator.maxVideoSeconds} seconds long.`
                  : undefined
            }
          >
            <option value="" disabled>
              Choose who can see this
            </option>
            {privacyLevels.map((level) => (
              <option key={level} value={level}>
                {TIKTOK_PRIVACY_LABELS[level]}
              </option>
            ))}
          </Select>

          <div className="grid gap-1">
            <p className="b88-label">Allow users to</p>
            <Checkbox
              label="Comment"
              description={creator.commentDisabled ? 'Turned off for this account in TikTok' : undefined}
              checked={!creator.commentDisabled && options.allowComment}
              disabled={disabled || creator.commentDisabled}
              onChange={(event) => set({ allowComment: event.target.checked })}
            />
            <Checkbox
              label="Duet"
              description={creator.duetDisabled ? 'Turned off for this account in TikTok' : undefined}
              checked={!creator.duetDisabled && options.allowDuet}
              disabled={disabled || creator.duetDisabled}
              onChange={(event) => set({ allowDuet: event.target.checked })}
            />
            <Checkbox
              label="Stitch"
              description={creator.stitchDisabled ? 'Turned off for this account in TikTok' : undefined}
              checked={!creator.stitchDisabled && options.allowStitch}
              disabled={disabled || creator.stitchDisabled}
              onChange={(event) => set({ allowStitch: event.target.checked })}
            />
          </div>

          <div className="grid gap-1">
            <Checkbox
              label="Disclose video content"
              description="Turn on if this video promotes yourself, a brand, product or service"
              checked={options.commercial}
              disabled={disabled}
              onChange={(event) =>
                set(
                  event.target.checked
                    ? { commercial: true }
                    : { commercial: false, yourBrand: false, brandedContent: false },
                )
              }
            />
            {options.commercial && (
              <div className="grid gap-1 pl-8">
                <Checkbox
                  label="Your brand"
                  description="You are promoting yourself or your own business. Labelled “Promotional content”"
                  checked={options.yourBrand}
                  disabled={disabled}
                  onChange={(event) => set({ yourBrand: event.target.checked })}
                />
                <Checkbox
                  label="Branded content"
                  description="You are promoting another brand or a third party. Labelled “Paid partnership”"
                  checked={options.brandedContent}
                  disabled={disabled}
                  onChange={(event) =>
                    set({
                      brandedContent: event.target.checked,
                      // A private choice is no longer allowed; make them pick again.
                      ...(event.target.checked && options.privacyLevel === 'SELF_ONLY' ? { privacyLevel: null } : {}),
                    })
                  }
                />
              </div>
            )}
          </div>

          {problem && <StatusMessage tone="error">{problem}</StatusMessage>}

          <p className="text-sm">
            {tiktokDeclaration(options)} After posting, TikTok can take a few minutes to process the video before it
            appears on the profile.
          </p>
        </>
      )}
    </section>
  );
}
