'use client';

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PostStatus } from '@prisma/client';
import { CalendarClock, Save, Send, Sparkles, Upload, UserCheck } from 'lucide-react';
import {
  AssetTile,
  Badge,
  Button,
  Field,
  StatusMessage,
  TextArea,
} from '@/bridge88/components';
import { uploadMediaAction } from '@/app/actions/media';
import type { ComposerState } from '@/app/actions/posts';
import { PendingButton } from '@/components/action-ui';
import { ComposerPreview } from '@/components/composer-preview';
import { PlatformGlyph } from '@/components/visuals';
import { CAPABILITIES } from '@/lib/social/capabilities';
import { PLATFORM_LABELS } from '@/lib/social/labels';
import {
  buildInitialDraft,
  clearStoredDraft,
  draftStorageKey,
  readStoredDraft,
  type ComposerAccount,
  type ComposerAsset,
  type ComposerCampaign,
  type ComposerDraft,
  type ComposerInitial,
  type PlatformVersionState,
  versionsToPayload,
  writeStoredDraft,
} from '@/lib/posts/composer';

type ComposerFormProps = {
  slug: string;
  action: (state: ComposerState, formData: FormData) => Promise<ComposerState>;
  accounts: ComposerAccount[];
  assets: ComposerAsset[];
  campaigns: ComposerCampaign[];
  timezone: string;
  postId?: string;
  postStatus?: PostStatus;
  canSchedule?: boolean;
  canPublish?: boolean;
  canSubmitForApproval?: boolean;
  initial?: ComposerInitial;
  attachAssetId?: string;
};

export function ComposerForm({
  slug,
  action,
  accounts,
  assets,
  campaigns,
  timezone,
  postId,
  postStatus,
  canSchedule = true,
  canPublish = true,
  canSubmitForApproval = true,
  initial,
  attachAssetId,
}: ComposerFormProps) {
  const router = useRouter();
  const storageKey = draftStorageKey(slug, postId);
  const baseDraft = useMemo(
    () => buildInitialDraft(accounts, initial, attachAssetId),
    [accounts, initial, attachAssetId],
  );
  const [draft, setDraft] = useState<ComposerDraft>(baseDraft);
  const [state, submit, isPending] = useActionState(action, {});
  const [aiError, setAiError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const hydrated = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const stored = readStoredDraft(storageKey);
    if (stored) setDraft(mergeDraft(baseDraft, stored, Boolean(initial)));
  }, [baseDraft, initial, storageKey]);

  useEffect(() => {
    if (!hydrated.current) return;
    writeStoredDraft(storageKey, draft);
  }, [draft, storageKey]);

  useEffect(() => {
    if (state.status === 'success') {
      clearStoredDraft(storageKey);
      if (state.redirectTo) router.push(state.redirectTo);
    }
  }, [router, state.redirectTo, state.status, storageKey]);

  useEffect(() => {
    if (!isPending) setPendingIntent(null);
  }, [isPending]);

  const activeAccount = accounts.find((account) => account.id === draft.activeAccountId) ?? accounts[0];
  const activeVersion = activeAccount ? draft.versions[activeAccount.id] : undefined;
  const caps = activeAccount ? CAPABILITIES[activeAccount.platform] : null;
  const fieldErrors = state.fields ?? {};
  const readOnly = postStatus === 'PUBLISHING';

  function updateDraft(patch: Partial<ComposerDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateVersion(accountId: string, patch: Partial<PlatformVersionState>) {
    setDraft((current) => ({
      ...current,
      versions: {
        ...current.versions,
        [accountId]: { ...current.versions[accountId], ...patch },
      },
    }));
  }

  function toggleMedia(accountId: string, assetId: string) {
    setDraft((current) => {
      const version = current.versions[accountId];
      const exists = version.media.some((item) => item.mediaAssetId === assetId);
      const media = exists
        ? version.media.filter((item) => item.mediaAssetId !== assetId)
        : [...version.media, { mediaAssetId: assetId, altText: '', thumbnailOffset: '' }];
      return {
        ...current,
        versions: { ...current.versions, [accountId]: { ...version, media } },
      };
    });
  }

  async function adaptForPlatforms() {
    if (!activeVersion) return;
    const source = activeVersion.text.trim();
    if (!source) {
      setAiError('Write a base caption before adapting.');
      return;
    }
    setAiLoading(true);
    setAiError('');
    try {
      const platforms = accounts.map((account) => account.platform);
      const response = await fetch(`/api/workspaces/${slug}/ai`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'adapt', prompt: source, platforms }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Adaptation failed.');
      const versions = body.data?.versions as Array<{ platform: string; text: string; hashtags: string[] }>;
      if (!Array.isArray(versions)) throw new Error('Unexpected AI response.');
      setDraft((current) => {
        const next = { ...current.versions };
        for (const account of accounts) {
          const adapted = versions.find((item) => item.platform === account.platform);
          if (!adapted) continue;
          next[account.id] = {
            ...next[account.id],
            text: adapted.text,
            hashtags: adapted.hashtags.join(', '),
          };
        }
        return { ...current, versions: next };
      });
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : 'Adaptation failed.');
    } finally {
      setAiLoading(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setUploadError('');
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append('files', file));
      const result = await uploadMediaAction(slug, formData);
      if (result.status === 'error' && result.error) {
        setUploadError(result.error);
        return;
      }
      router.refresh();
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function submitWithIntent(intent: string) {
    setPendingIntent(intent);
    const formData = new FormData();
    formData.set('intent', intent);
    formData.set('title', draft.title);
    formData.set('campaignId', draft.campaignId);
    formData.set('scheduledAt', draft.scheduledAt);
    formData.set('platforms', JSON.stringify(versionsToPayload(draft.versions, draft.activeAccountId)));
    startTransition(() => submit(formData));
  }

  if (!activeAccount || !activeVersion) return null;

  const accountErrors = fieldErrors[activeAccount.id] ?? [];
  const isPendingApproval = postStatus === 'PENDING_APPROVAL';
  const isPublished = postStatus === 'PUBLISHED';

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
      <section className="b88-card">
        {postStatus === 'PUBLISHED' && (
          <StatusMessage tone="neutral" className="mb-6">
            This post is live. Saving creates a new draft with your changes.
          </StatusMessage>
        )}
        {readOnly && (
          <StatusMessage tone="neutral" className="mb-6">
            This post is publishing and cannot be edited right now.
          </StatusMessage>
        )}
        {state.error && <StatusMessage tone="error" className="mb-6">{state.error}</StatusMessage>}
        {state.success && <StatusMessage tone="success" className="mb-6">{state.success}</StatusMessage>}

        <form className="grid gap-6" onSubmit={(event) => { event.preventDefault(); submitWithIntent('draft'); }}>
          <Field
            label="Internal title"
            name="title"
            value={draft.title}
            onChange={(event) => updateDraft({ title: event.target.value })}
            placeholder="Q4 launch thread"
            disabled={readOnly}
          />

          <label className="block">
            <span className="b88-label">Campaign</span>
            <select
              className="b88-input"
              value={draft.campaignId}
              onChange={(event) => updateDraft({ campaignId: event.target.value })}
              disabled={readOnly}
            >
              <option value="">No campaign</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-2">
            {accounts.map((account) => {
              const selected = account.id === draft.activeAccountId;
              const issues = fieldErrors[account.id]?.length ?? 0;
              const handle = account.accountHandle ?? account.accountName;
              return (
                <Button
                  key={account.id}
                  type="button"
                  variant={selected ? 'primary' : 'secondary'}
                  onClick={() => updateDraft({ activeAccountId: account.id })}
                >
                  <PlatformGlyph platform={account.platform} size={16} />
                  <span className="font-[540]">{PLATFORM_LABELS[account.platform]}</span>
                  <span className="b88-caption">{handle}</span>
                  {issues > 0 && <Badge tone="coral">{issues}</Badge>}
                </Button>
              );
            })}
          </div>

          {accountErrors.length > 0 && (
            <StatusMessage tone="error">
              <ul className="list-disc pl-5">
                {accountErrors.map((message) => <li key={message}>{message}</li>)}
              </ul>
            </StatusMessage>
          )}

          <TextArea
            label={`${PLATFORM_LABELS[activeAccount.platform]} caption`}
            value={activeVersion.text}
            onChange={(event) => updateVersion(activeAccount.id, { text: event.target.value })}
            hint={caps ? `${activeVersion.text.length} / ${caps.maxTextLength}` : undefined}
            disabled={readOnly}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Hashtags"
              value={activeVersion.hashtags}
              onChange={(event) => updateVersion(activeAccount.id, { hashtags: event.target.value })}
              placeholder="#launch, #product"
              disabled={readOnly}
            />
            <Field
              label="Mentions"
              value={activeVersion.mentions}
              onChange={(event) => updateVersion(activeAccount.id, { mentions: event.target.value })}
              placeholder="@bridge88"
              disabled={readOnly}
            />
          </div>

          {caps?.supportsLink && (
            <Field
              label="Link"
              value={activeVersion.link}
              onChange={(event) => updateVersion(activeAccount.id, { link: event.target.value })}
              placeholder="https://"
              disabled={readOnly}
            />
          )}

          {caps?.supportsFirstComment && (
            <TextArea
              label="First comment"
              value={activeVersion.firstComment}
              onChange={(event) => updateVersion(activeAccount.id, { firstComment: event.target.value })}
              disabled={readOnly}
            />
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="b88-label">Media for {PLATFORM_LABELS[activeAccount.platform]}</p>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={(event) => uploadFiles(event.target.files)}
                />
                <Button type="button" variant="secondary" disabled={uploading || readOnly} onClick={() => fileInputRef.current?.click()}>
                  <Upload size={16} />
                  {uploading ? 'Uploading' : 'Upload'}
                </Button>
                <Button type="button" variant="secondary" disabled={aiLoading || readOnly} onClick={adaptForPlatforms}>
                  <Sparkles size={16} />
                  {aiLoading ? 'Adapting' : 'Adapt for platforms'}
                </Button>
              </div>
            </div>
            {aiError && <p role="alert" className="mt-3 text-sm text-[var(--accent-magenta)]">{aiError}</p>}
            {uploadError && <p role="alert" className="mt-3 text-sm text-[var(--accent-magenta)]">{uploadError}</p>}
            <div className="mt-4 max-h-96 overflow-y-auto pr-2">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {assets.map((asset) => {
                const selected = activeVersion.media.some((item) => item.mediaAssetId === asset.id);
                return (
                  <div
                    key={asset.id}
                    className={`transition-opacity hover:opacity-80 ${readOnly ? 'pointer-events-none opacity-40' : ''}`}
                  >
                    <AssetTile
                      title={asset.filename}
                      meta={selected ? 'Selected' : undefined}
                      type={asset.type === 'VIDEO' ? 'video' : 'image'}
                      ratio="1:1"
                      src={asset.thumbnailUrl}
                      selected={selected}
                      onClick={() => toggleMedia(activeAccount.id, asset.id)}
                    />
                  </div>
                );
              })}
              </div>
            </div>
            {activeVersion.media.length > 0 && (
              <div className="mt-4 space-y-4">
                {activeVersion.media.map((item, index) => {
                  const asset = assets.find((entry) => entry.id === item.mediaAssetId);
                  return (
                    <div key={item.mediaAssetId} className="b88-tile space-y-3">
                      <p className="text-sm font-[540]">{asset?.filename ?? 'Media'}</p>
                      {caps?.supportsAltText && (
                        <Field
                          label="Alt text"
                          value={item.altText}
                          onChange={(event) => {
                            const media = activeVersion.media.map((entry, i) =>
                              i === index ? { ...entry, altText: event.target.value } : entry,
                            );
                            updateVersion(activeAccount.id, { media });
                          }}
                          disabled={readOnly}
                        />
                      )}
                      {asset?.type === 'VIDEO' && (
                        <Field
                          label="Thumbnail offset (seconds)"
                          type="number"
                          min={0}
                          step={0.1}
                          value={item.thumbnailOffset}
                          onChange={(event) => {
                            const media = activeVersion.media.map((entry, i) =>
                              i === index ? { ...entry, thumbnailOffset: event.target.value } : entry,
                            );
                            updateVersion(activeAccount.id, { media });
                          }}
                          disabled={readOnly}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Field
            label={`Schedule (${timezone})`}
            type="datetime-local"
            value={draft.scheduledAt}
            onChange={(event) => updateDraft({ scheduledAt: event.target.value })}
            hint="Required when scheduling. Times use your workspace timezone."
            disabled={readOnly}
          />

          <div className="pb-16">
            <p className="b88-label">What happens next?</p>
            <div className="b88-selection-bar">
              <PendingButton
                type="submit"
                variant="secondary"
                pendingLabel="Saving"
                disabled={readOnly || isPending}
                aria-busy={pendingIntent === 'draft'}
              >
                <Save size={16} />
                {pendingIntent === 'draft' ? 'Saving' : 'Save draft'}
              </PendingButton>
              {canSubmitForApproval && (
                <PendingButton
                  type="button"
                  variant="secondary"
                  pendingLabel="Submitting"
                  disabled={readOnly || isPending}
                  aria-busy={pendingIntent === 'approval'}
                  onClick={() => submitWithIntent('approval')}
                >
                  <UserCheck size={16} />
                  {pendingIntent === 'approval' ? 'Submitting' : 'Submit for approval'}
                </PendingButton>
              )}
              {canSchedule && (
                <PendingButton
                  type="button"
                  variant="secondary"
                  pendingLabel="Scheduling"
                  disabled={readOnly || isPending}
                  aria-busy={pendingIntent === 'schedule'}
                  onClick={() => submitWithIntent('schedule')}
                >
                  <CalendarClock size={16} />
                  {pendingIntent === 'schedule' ? 'Scheduling' : 'Schedule'}
                </PendingButton>
              )}
              {canPublish && !isPendingApproval && (
                <PendingButton
                  type="button"
                  variant={isPublished ? 'tertiary' : 'promo'}
                  pendingLabel="Publishing"
                  disabled={readOnly || isPending}
                  aria-busy={pendingIntent === 'publish'}
                  onClick={() => submitWithIntent('publish')}
                >
                  <Send size={16} />
                  {pendingIntent === 'publish' ? 'Publishing' : 'Publish now'}
                </PendingButton>
              )}
            </div>
            {isPendingApproval && (
              <p className="b88-caption mt-3">
                This post is awaiting approval. Save your changes or wait for a reviewer before publishing.
              </p>
            )}
          </div>
        </form>
      </section>

      <aside className="space-y-3 self-start">
        <ComposerPreview account={activeAccount} version={activeVersion} assets={assets} />
        <p className="b88-caption">
          Draft autosaved locally · {postId ? `Post ${postId.slice(0, 8)}` : 'New post'}
        </p>
      </aside>
    </div>
  );
}

function mergeDraft(base: ComposerDraft, stored: ComposerDraft, preserveInitialPlatform: boolean): ComposerDraft {
  const versions = { ...base.versions };
  for (const [accountId, version] of Object.entries(stored.versions ?? {})) {
    if (versions[accountId]) versions[accountId] = version;
  }
  return {
    title: stored.title ?? base.title,
    campaignId: stored.campaignId ?? base.campaignId,
    scheduledAt: stored.scheduledAt ?? base.scheduledAt,
    activeAccountId: preserveInitialPlatform
      ? base.activeAccountId
      : stored.activeAccountId ?? base.activeAccountId,
    versions,
  };
}
