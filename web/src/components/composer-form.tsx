'use client';

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PostStatus } from '@prisma/client';
import { ArrowDown, ArrowUp, CalendarClock, RefreshCw, Save, Send, Sparkles, Trash2, UserCheck } from 'lucide-react';
import {
  AssetTile,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  MediaUploader,
  Select,
  StatusMessage,
  TextArea,
} from '@/bridge88/components';
import { uploadMediaAction } from '@/app/actions/media';
import { loadMoreComposerAssetsAction, type ComposerState } from '@/app/actions/posts';
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
import { legalPostActions } from '@/lib/posts/lifecycle';

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
  contextDefaults?: { scheduledAt?: string; campaignId?: string };
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
  contextDefaults,
}: ComposerFormProps) {
  const router = useRouter();
  const storageKey = draftStorageKey(slug, postId);
  const baseDraft = useMemo(
    () => buildInitialDraft(accounts, initial, attachAssetId, contextDefaults),
    [accounts, initial, attachAssetId, contextDefaults],
  );
  const [draft, setDraft] = useState<ComposerDraft>(baseDraft);
  const [state, submit, isPending] = useActionState(action, {});
  const [aiError, setAiError] = useState('');
  const [aiAnnouncement, setAiAnnouncement] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [replacement, setReplacement] = useState<{ accountId: string; index: number } | null>(null);
  const [libraryAssets, setLibraryAssets] = useState(assets);
  const [assetOffset, setAssetOffset] = useState(12);
  const [hasMoreAssets, setHasMoreAssets] = useState(assets.length >= 12);
  const [loadingMoreAssets, setLoadingMoreAssets] = useState(false);
  const [, startTransition] = useTransition();
  const hydrated = useRef(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const stored = readStoredDraft(storageKey);
    if (stored) {
      const merged = mergeDraft(baseDraft, stored, Boolean(initial));
      setDraft({
        ...merged,
        scheduledAt: contextDefaults?.scheduledAt ?? merged.scheduledAt,
        campaignId: contextDefaults?.campaignId ?? merged.campaignId,
      });
    }
  }, [baseDraft, contextDefaults, initial, storageKey]);

  useEffect(() => {
    if (!hydrated.current) return;
    writeStoredDraft(storageKey, draft);
  }, [draft, storageKey]);

  useEffect(() => {
    if (state.status === 'success') {
      if (state.savedUpdatedAt) {
        setDraft((current) => ({ ...current, sourceUpdatedAt: state.savedUpdatedAt ?? current.sourceUpdatedAt }));
      }
      clearStoredDraft(storageKey);
      if (state.redirectTo) router.push(state.redirectTo);
    }
  }, [router, state.redirectTo, state.savedUpdatedAt, state.status, storageKey]);

  useEffect(() => {
    if (!isPending) setPendingIntent(null);
  }, [isPending]);

  useEffect(() => {
    setLibraryAssets((current) => [
      ...new Map([...current, ...assets].map((asset) => [asset.id, asset])).values(),
    ]);
  }, [assets]);

  useEffect(() => {
    if (state.status === 'error') errorSummaryRef.current?.focus();
  }, [state.status]);

  const lifecycleActions = legalPostActions(postStatus ?? 'DRAFT');
  const activeAccount = accounts.find((account) => account.id === draft.activeAccountId) ?? accounts[0];
  const activeVersion = activeAccount ? draft.versions[activeAccount.id] : undefined;
  const caps = activeAccount ? CAPABILITIES[activeAccount.platform] : null;
  const fieldErrors = state.fields ?? {};
  const readOnly = !lifecycleActions.includes('edit');
  const selectedAccounts = accounts.filter((account) => draft.selectedAccountIds.includes(account.id));
  const demoMode = selectedAccounts.some((account) => account.isDemo);

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

  function chooseMedia(accountId: string, assetId: string) {
    if (replacement?.accountId !== accountId) {
      toggleMedia(accountId, assetId);
      return;
    }
    const version = draft.versions[accountId];
    const replacing = version.media[replacement.index];
    if (!replacing || version.media.some((item, index) =>
      index !== replacement.index && item.mediaAssetId === assetId)) {
      setReplacement(null);
      return;
    }
    const media = version.media.map((item, index) =>
      index === replacement.index
        ? { mediaAssetId: assetId, altText: '', thumbnailOffset: '' }
        : item,
    );
    updateVersion(accountId, { media });
    setReplacement(null);
  }

  function toggleAccount(accountId: string, selected: boolean) {
    setDraft((current) => {
      if (!selected && current.selectedAccountIds.length === 1) return current;
      const selectedAccountIds = selected
        ? [...current.selectedAccountIds, accountId]
        : current.selectedAccountIds.filter((id) => id !== accountId);
      return {
        ...current,
        selectedAccountIds,
        activeAccountId: selected
          ? accountId
          : current.activeAccountId === accountId
            ? selectedAccountIds[0]
            : current.activeAccountId,
      };
    });
  }

  function moveMedia(accountId: string, from: number, to: number) {
    const currentMedia = draft.versions[accountId]?.media;
    if (!currentMedia || to < 0 || to >= currentMedia.length) return;
    const media = [...currentMedia];
    const [item] = media.splice(from, 1);
    media.splice(to, 0, item);
    updateVersion(accountId, { media });
  }

  async function runAi(operation: 'generate' | 'rewrite' | 'hashtags' | 'cta' | 'adapt') {
    if (!activeVersion) return;
    const source = operation === 'generate' ? draft.title.trim() : activeVersion.text.trim();
    if (source.length < 3) {
      setAiError(
        operation === 'generate'
          ? 'Add an internal title with at least three characters before generating a caption.'
          : 'Write at least three characters before using this AI action.',
      );
      return;
    }
    setAiLoading(operation);
    setAiError('');
    setAiAnnouncement('');
    try {
      const platforms = selectedAccounts.map((account) => account.platform);
      const response = await fetch(`/api/workspaces/${slug}/ai`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          operation === 'adapt'
            ? { operation, prompt: source, platforms }
            : { operation, prompt: source, platform: activeAccount.platform },
        ),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'AI action failed.');
      if (operation === 'adapt') {
        const versions = body.data?.versions as Array<{ platform: string; text: string; hashtags: string[] }>;
        if (!Array.isArray(versions)) throw new Error('Unexpected AI response.');
        setDraft((current) => {
          const next = { ...current.versions };
          for (const account of selectedAccounts) {
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
      } else if (operation === 'hashtags') {
        const hashtags = body.data?.hashtags;
        if (!Array.isArray(hashtags)) throw new Error('Unexpected AI response.');
        updateVersion(activeAccount.id, { hashtags: hashtags.join(', ') });
      } else {
        if (typeof body.data?.text !== 'string') throw new Error('Unexpected AI response.');
        updateVersion(activeAccount.id, {
          text: body.data.text,
          ...(Array.isArray(body.data.hashtags) ? { hashtags: body.data.hashtags.join(', ') } : {}),
        });
      }
      setAiAnnouncement({
        generate: 'Caption generated.',
        rewrite: 'Caption rewritten.',
        hashtags: 'Hashtags generated.',
        cta: 'Call to action generated.',
        adapt: 'Selected channel versions adapted.',
      }[operation]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'AI action failed.';
      setAiError(message);
      setAiAnnouncement(message);
    } finally {
      setAiLoading(null);
    }
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setUploadError('');
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));
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
    }
  }

  async function loadMoreAssets() {
    setLoadingMoreAssets(true);
    try {
      const result = await loadMoreComposerAssetsAction(slug, assetOffset);
      setLibraryAssets((current) => [
        ...new Map([...current, ...result.assets].map((asset) => [asset.id, asset])).values(),
      ]);
      setAssetOffset((current) => current + 12);
      setHasMoreAssets(result.hasMore);
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : 'More media could not be loaded.');
    } finally {
      setLoadingMoreAssets(false);
    }
  }

  function submitWithIntent(intent: string) {
    setPendingIntent(intent);
    const formData = new FormData();
    formData.set('intent', intent);
    formData.set('title', draft.title);
    formData.set('campaignId', draft.campaignId);
    formData.set('scheduledAt', draft.scheduledAt);
    if (draft.sourceUpdatedAt) formData.set('expectedUpdatedAt', draft.sourceUpdatedAt);
    formData.set('platforms', JSON.stringify(versionsToPayload(draft.versions, draft.selectedAccountIds)));
    startTransition(() => submit(formData));
  }

  if (!activeAccount || !activeVersion) return null;

  const accountErrors = fieldErrors[activeAccount.id] ?? [];
  const isPendingApproval = postStatus === 'PENDING_APPROVAL';
  return (
    <>
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
        <StatusMessage tone="neutral" className="mb-6">
          Changes are recovered from this browser as you type. Use Save draft to keep the post in your workspace across devices and sign-ins.
        </StatusMessage>
        {demoMode && (
          <StatusMessage tone="neutral" className="mb-6">
            Demo mode is active. Publish now simulates delivery and does not create a real platform post.
          </StatusMessage>
        )}
        {state.error && (
          <div ref={errorSummaryRef} tabIndex={-1}>
            <StatusMessage tone="error" className="mb-6">{state.error}</StatusMessage>
          </div>
        )}
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

          <Select
            label="Campaign"
            value={draft.campaignId}
            onChange={(event) => updateDraft({ campaignId: event.target.value })}
            disabled={readOnly}
          >
            <option value="">No campaign</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
            ))}
          </Select>

          <div>
            <p className="b88-label">Publishing channels</p>
            <p className="mb-3 text-sm">Choose every account that should receive its own editable version.</p>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {accounts.map((account) => {
                const selected = draft.selectedAccountIds.includes(account.id);
                const handle = account.accountHandle ?? account.accountName;
                return (
                  <Checkbox
                    key={account.id}
                    label={`${PLATFORM_LABELS[account.platform]} · ${handle}`}
                    description={account.isDemo ? 'Simulated publishing' : undefined}
                    checked={selected}
                    disabled={readOnly || (selected && draft.selectedAccountIds.length === 1)}
                    onChange={(event) => toggleAccount(account.id, event.target.checked)}
                  />
                );
              })}
            </div>
          </div>

          <div>
            <p className="b88-label">Edit version</p>
            <div className="flex flex-wrap gap-2">
              {selectedAccounts.map((account) => {
                const active = account.id === draft.activeAccountId;
                const issues = fieldErrors[account.id]?.length ?? 0;
                const handle = account.accountHandle ?? account.accountName;
                return (
                  <Button
                    key={account.id}
                    type="button"
                    variant={active ? 'primary' : 'secondary'}
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
            hint={caps && activeVersion.text.length <= caps.maxTextLength
              ? `${activeVersion.text.length} / ${caps.maxTextLength}`
              : undefined}
            error={caps && activeVersion.text.length > caps.maxTextLength
              ? `${activeVersion.text.length - caps.maxTextLength} characters over the ${PLATFORM_LABELS[activeAccount.platform]} limit.`
              : undefined}
            disabled={readOnly}
          />

          <div>
            <p className="b88-label">AI writing</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={Boolean(aiLoading) || readOnly} aria-busy={aiLoading === 'generate'} onClick={() => runAi('generate')}>
                <Sparkles size={16} />Generate caption
              </Button>
              <Button type="button" variant="secondary" disabled={Boolean(aiLoading) || readOnly} aria-busy={aiLoading === 'rewrite'} onClick={() => runAi('rewrite')}>
                Rewrite
              </Button>
              <Button type="button" variant="secondary" disabled={Boolean(aiLoading) || readOnly} aria-busy={aiLoading === 'hashtags'} onClick={() => runAi('hashtags')}>
                Generate hashtags
              </Button>
              <Button type="button" variant="secondary" disabled={Boolean(aiLoading) || readOnly} aria-busy={aiLoading === 'cta'} onClick={() => runAi('cta')}>
                Generate CTA
              </Button>
              {selectedAccounts.length > 1 && (
                <Button type="button" variant="secondary" disabled={Boolean(aiLoading) || readOnly} aria-busy={aiLoading === 'adapt'} onClick={() => runAi('adapt')}>
                  Adapt selected channels
                </Button>
              )}
            </div>
            {aiError && <p role="alert" className="mt-3 text-sm text-[var(--accent-magenta)]">{aiError}</p>}
            <p role="status" aria-live="polite" className="sr-only">{aiAnnouncement}</p>
          </div>

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
            </div>
            <fieldset
              disabled={readOnly || uploading}
              className={`mt-3 min-w-0 border-0 p-0 ${readOnly ? 'opacity-40' : ''}`}
              onChange={(event) => {
                const input = event.nativeEvent.target;
                if (!(input instanceof HTMLInputElement)) return;
                if (input.type === 'file' && input.files) void uploadFiles(Array.from(input.files));
              }}
            >
              <MediaUploader
                compact
                title={uploading ? 'Uploading media' : 'Drop or choose media'}
                hint="JPG · PNG · GIF · MP4 · MOV · WEBM · MP3 · WAV"
              />
            </fieldset>
            {uploadError && <p role="alert" className="mt-3 text-sm text-[var(--accent-magenta)]">{uploadError}</p>}
            <p className="mt-3 text-sm">
              Select assets for this channel. Select an attached asset again to remove it.
            </p>
            {replacement?.accountId === activeAccount.id && (
              <StatusMessage tone="neutral" className="mt-3">
                Choose a different asset below. The replacement is not saved until you save the post.
              </StatusMessage>
            )}
            <div className="mt-4 max-h-96 overflow-y-auto pr-2">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {libraryAssets.map((asset) => {
                const selected = activeVersion.media.some((item) => item.mediaAssetId === asset.id);
                return (
                  <div
                    key={asset.id}
                    className={`transition-opacity hover:opacity-80 ${readOnly ? 'pointer-events-none opacity-40' : ''}`}
                  >
                    <AssetTile
                      title={asset.filename}
                      meta={`${asset.type.toLowerCase()}${selected ? ' · Selected' : ''}`}
                      type={asset.type === 'VIDEO' ? 'video' : 'image'}
                      ratio="1:1"
                      src={asset.thumbnailUrl}
                      selected={selected}
                      onClick={() => chooseMedia(activeAccount.id, asset.id)}
                    />
                  </div>
                );
              })}
              </div>
            </div>
            {hasMoreAssets && (
              <Button
                type="button"
                variant="secondary"
                className="mt-4"
                disabled={loadingMoreAssets}
                aria-busy={loadingMoreAssets}
                onClick={loadMoreAssets}
              >
                Load more media
              </Button>
            )}
            {activeVersion.media.length > 0 && (
              <div className="mt-4 space-y-4">
                {activeVersion.media.map((item, index) => {
                  const asset = libraryAssets.find((entry) => entry.id === item.mediaAssetId);
                  return (
                    <div key={item.mediaAssetId} className="b88-tile space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-[540]">{asset?.filename ?? 'Missing media'}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="tertiary"
                            disabled={readOnly}
                            onClick={() => setReplacement({ accountId: activeAccount.id, index })}
                          >
                            <RefreshCw size={16} />Replace
                          </Button>
                          <Button
                            type="button"
                            variant="tertiary"
                            disabled={readOnly || index === 0}
                            onClick={() => moveMedia(activeAccount.id, index, index - 1)}
                          >
                            <ArrowUp size={16} />Move up
                          </Button>
                          <Button
                            type="button"
                            variant="tertiary"
                            disabled={readOnly || index === activeVersion.media.length - 1}
                            onClick={() => moveMedia(activeAccount.id, index, index + 1)}
                          >
                            <ArrowDown size={16} />Move down
                          </Button>
                          <Button
                            type="button"
                            variant="tertiary"
                            disabled={readOnly}
                            onClick={() => toggleMedia(activeAccount.id, item.mediaAssetId)}
                          >
                            <Trash2 size={16} />Remove
                          </Button>
                        </div>
                      </div>
                      {!asset && (
                        <StatusMessage tone="error">
                          This asset is no longer available. Remove it before saving.
                        </StatusMessage>
                      )}
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
            <div
              className="b88-selection-bar"
              role="region"
              aria-label="Post actions"
              style={{ flexWrap: 'nowrap', justifyContent: 'flex-start', overflowX: 'auto' }}
            >
              {lifecycleActions.includes('edit') && <PendingButton
                type="submit"
                variant="secondary"
                className="shrink-0 whitespace-nowrap"
                pendingLabel="Saving"
                disabled={readOnly || isPending}
                aria-busy={pendingIntent === 'draft'}
              >
                <Save size={16} />
                Save draft
              </PendingButton>}
              {canPublish && lifecycleActions.includes('publish') && !isPendingApproval && (
                <PendingButton
                  type="button"
                  variant="promo"
                  className="shrink-0 whitespace-nowrap"
                  pendingLabel="Publishing"
                  disabled={readOnly || isPending}
                  aria-busy={pendingIntent === 'publish'}
                  onClick={() => setPublishConfirmOpen(true)}
                >
                  <Send size={16} />
                  Publish now
                </PendingButton>
              )}
              {canSchedule && (lifecycleActions.includes('schedule') || lifecycleActions.includes('reschedule')) && (
                <PendingButton
                  type="button"
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap"
                  pendingLabel="Scheduling"
                  disabled={readOnly || isPending}
                  aria-busy={pendingIntent === 'schedule'}
                  onClick={() => submitWithIntent('schedule')}
                >
                  <CalendarClock size={16} />
                  Schedule
                </PendingButton>
              )}
              {canSubmitForApproval && lifecycleActions.includes('submitForApproval') && (
                <PendingButton
                  type="button"
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap"
                  pendingLabel="Submitting"
                  disabled={readOnly || isPending}
                  aria-busy={pendingIntent === 'approval'}
                  onClick={() => submitWithIntent('approval')}
                >
                  <UserCheck size={16} />
                  Submit for approval
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
        <ComposerPreview account={activeAccount} version={activeVersion} assets={libraryAssets} />
        <p className="b88-caption">
          Draft autosaved locally · {postId ? `Post ${postId.slice(0, 8)}` : 'New post'}
        </p>
      </aside>
    </div>
    <Dialog
      open={publishConfirmOpen}
      eyebrow="Confirm publishing"
      title="Publish this post now?"
      onClose={() => setPublishConfirmOpen(false)}
      actions={<>
        <Button type="button" variant="secondary" onClick={() => setPublishConfirmOpen(false)}>
          Keep editing
        </Button>
        <Button
          type="button"
          disabled={isPending}
          onClick={() => {
            setPublishConfirmOpen(false);
            submitWithIntent('publish');
          }}
        >
          Publish now
        </Button>
      </>}
    >
      Bridge88 will publish immediately to {selectedAccounts.map((account) =>
        `${PLATFORM_LABELS[account.platform]} (${account.accountHandle ?? account.accountName})`
      ).join(', ')}. Publishing cannot be undone from Bridge88.
    </Dialog>
    </>
  );
}

function mergeDraft(base: ComposerDraft, stored: ComposerDraft, preserveInitialPlatform: boolean): ComposerDraft {
  const versions = { ...base.versions };
  for (const [accountId, version] of Object.entries(stored.versions ?? {})) {
    if (versions[accountId]) versions[accountId] = version;
  }
  const selectedAccountIds = (stored.selectedAccountIds ?? base.selectedAccountIds)
    .filter((accountId) => Boolean(versions[accountId]));
  const safeSelectedAccountIds = selectedAccountIds.length ? selectedAccountIds : base.selectedAccountIds;
  const requestedActiveAccountId = preserveInitialPlatform
    ? base.activeAccountId
    : stored.activeAccountId ?? base.activeAccountId;
  return {
    title: stored.title ?? base.title,
    campaignId: stored.campaignId ?? base.campaignId,
    scheduledAt: stored.scheduledAt ?? base.scheduledAt,
    activeAccountId: safeSelectedAccountIds.includes(requestedActiveAccountId)
      ? requestedActiveAccountId
      : safeSelectedAccountIds[0],
    selectedAccountIds: safeSelectedAccountIds,
    sourceUpdatedAt: stored.sourceUpdatedAt ?? base.sourceUpdatedAt,
    versions,
  };
}
