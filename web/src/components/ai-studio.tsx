'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ImageIcon, Mic2, RefreshCw, Trash2, Video, X } from 'lucide-react';
import { Badge, Button, Dialog, Dropdown, EmptyState, StatusMessage, TextArea, humanizeMachineValue } from '@/bridge88/components';
import {
  cancelAiMediaJobAction,
  createAiMediaJobAction,
  deleteGeneratedAssetAction,
  generateStudioImageAction,
  retryAiMediaJobAction,
} from '@/app/actions/ai';
import type { AiMediaJobKind, JobStatus } from '@prisma/client';
import { AI_MEDIA_JOB_LABELS, JOB_STATUS_LABELS } from '@/lib/ai/labels';
import { AiJobProgress } from '@/components/ai-job-progress';
import { DEFAULT_IMAGE_SIZE, IMAGE_SIZE_PRESETS, imageSizeAvailableFor, type ImageSize } from '@/lib/ai/image-sizes';
import type { ImageProviderName } from '@/lib/ai/provider-selection';

type Asset = { id: string; filename: string; type: string; url: string; generated: boolean };
type Job = {
  id: string;
  kind: AiMediaJobKind;
  status: JobStatus;
  error: string | null;
  prompt: string;
  outputAssetId: string | null;
  createdAt: string;
  startedAt: string | null;
  provider: string;
};
type JobAction = 'IMAGE_VARIATION' | 'VIDEO_GENERATE' | 'VIDEO_ANIMATE' | 'AUDIO_TTS';
type Action = 'IMAGE' | 'REGENERATE' | 'CANCEL' | 'RETRY' | 'DELETE' | JobAction;

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING'];
// Jobs finish in the worker, so the page has to ask the server again to see the
// result. Four seconds is short enough to feel live and only runs while work is open.
const POLL_MS = 4000;

function statusTone(status: string) {
  if (status === 'COMPLETED') return 'lime' as const;
  if (status === 'FAILED' || status === 'CANCELLED') return 'coral' as const;
  return 'cream' as const;
}

// Rows created in this tab sit on top until the server render includes them. Only
// ids still held in localIds are pinned, so rows the server has dropped from the
// window (it returns a fixed page) are not resurrected on the next refresh.
function mergeLocalFirst<T extends { id: string }>(incoming: T[], current: T[], localIds: Set<string>) {
  for (const entry of incoming) localIds.delete(entry.id);
  const pinned = current.filter((entry) => localIds.has(entry.id));
  return pinned.length ? [...pinned, ...incoming] : incoming;
}

// Both labels share one grid cell, so the control keeps the width of the longer of
// the two and never resizes mid-action — intrinsic-width mobile buttons especially.
function ActionLabel({ idle, busy, isBusy }: { idle: string; busy: string; isBusy: boolean }) {
  return (
    <span className="grid justify-items-center">
      <span className="col-start-1 row-start-1" style={{ visibility: isBusy ? 'hidden' : 'visible' }}>{idle}</span>
      <span className="col-start-1 row-start-1" style={{ visibility: isBusy ? 'visible' : 'hidden' }}>{busy}</span>
    </span>
  );
}

/**
 * The same three choices an Image generator step offers, in the same order, so
 * the two surfaces cannot teach different mental models. Codex leads because it
 * is the one that costs nothing per image.
 */
const IMAGE_SOURCES: Array<{ value: ImageProviderName; label: string }> = [
  { value: 'image-use', label: 'Codex — ChatGPT subscription, queued' },
  { value: 'openai', label: 'API — instant, billed per image' },
  { value: 'mock', label: 'Mock — free placeholder, instant' },
];

export function AiStudio({ slug, initialAssets, initialJobs, initialSourceAssetId, simulated }: {
  slug: string;
  initialAssets: Asset[];
  initialJobs: Job[];
  initialSourceAssetId?: string;
  simulated: boolean;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('A clean editorial workspace for planning social content');
  // Square, not the workflow default: a studio image is composed on its own,
  // not cropped into a vertical video.
  const [size, setSize] = useState<ImageSize>(DEFAULT_IMAGE_SIZE);
  // Codex regardless of how the deployment is configured: the choice belongs to
  // whoever is making the image, and this is the one with no per-image bill.
  const [source, setSource] = useState<ImageProviderName>('image-use');

  /**
   * Both pickers are remembered per workspace.
   *
   * Someone working through a batch picks a shape and a source once; making
   * them redo it after every trip to the Media Library is the kind of friction
   * that makes a tool feel hostile. Read after mount rather than in the initial
   * state so the server and the first client render agree.
   */
  useEffect(() => {
    const saved = readStudioPrefs(slug);
    if (saved.source) setSource(saved.source);
    if (saved.size) setSize(saved.size);
  }, [slug]);
  const [assets, setAssets] = useState(initialAssets);
  const [jobs, setJobs] = useState(initialJobs);
  const [selected, setSelected] = useState<string | undefined>(initialSourceAssetId);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(initialSourceAssetId ? 'Source asset selected. Choose an operation below or write a new brief.' : '');
  const [deleteTarget, setDeleteTarget] = useState<Asset>();
  const [now, setNow] = useState(Date.now());
  const [showAllAssets, setShowAllAssets] = useState(false);
  const [showAllJobs, setShowAllJobs] = useState(false);
  // Pending is tracked per action so one request never disables or relabels the
  // controls that did not start it.
  const [pending, setPending] = useState<Action[]>([]);
  const localAssetIds = useRef(new Set<string>());
  const localJobIds = useRef(new Set<string>());

  const activeJobs = jobs.filter((job) => ACTIVE_STATUSES.includes(job.status));
  const recentJobs = jobs.slice(0, 3);
  const selectedAsset = assets.find((asset) => asset.id === selected);
  const firstAssets = assets.slice(0, 4);
  const visibleAssets = showAllAssets || !selectedAsset || firstAssets.some((asset) => asset.id === selectedAsset.id)
    ? (showAllAssets ? assets : firstAssets)
    : [selectedAsset, ...firstAssets.slice(0, 3)];
  /**
   * This panel is about work in flight, not a log.
   *
   * Showing the three most recent rows meant a page opened months later led
   * with three finished jobs and their buttons, which is noise in the place a
   * person looks to see whether anything is happening. Anything still running,
   * plus whatever this session started, and the full history stays one click
   * away.
   */
  const sessionJobs = jobs.filter(
    (job) => ACTIVE_STATUSES.includes(job.status) || localJobIds.current.has(job.id),
  );
  const visibleJobs = showAllJobs ? jobs : sessionJobs;

  useEffect(() => {
    setAssets((current) => mergeLocalFirst(initialAssets, current, localAssetIds.current));
  }, [initialAssets]);

  useEffect(() => {
    setJobs((current) => mergeLocalFirst(initialJobs, current, localJobIds.current));
  }, [initialJobs]);

  // Re-render the route in the background while work is open; no full reload and no
  // route-level loading fallback. Stops as soon as every job reaches a terminal state.
  useEffect(() => {
    if (!activeJobs.length) return;
    const timer = window.setInterval(() => router.refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeJobs.length, router]);

  useEffect(() => {
    if (!activeJobs.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeJobs.length]);

  async function run(action: Action, work: () => Promise<void>, fallbackMessage: string) {
    setError('');
    setPending((current) => [...current, action]);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallbackMessage);
    } finally {
      setPending((current) => current.filter((entry) => entry !== action));
    }
  }

  function generate(action: Action, sourceAssetId?: string) {
    return run(action, async () => {
      const result = await generateStudioImageAction(slug, { prompt, size, sourceAssetId, provider: source });
      // Where the image provider is a local CLI, the server cannot generate
      // inside the request — it queues instead, and the jobs panel below takes
      // over from here.
      if (result.queued) {
        localJobIds.current.add(result.job.id);
        setJobs((current) => [{
          id: result.job.id,
          kind: result.job.kind,
          status: result.job.status,
          error: null,
          prompt,
          outputAssetId: null,
          createdAt: new Date().toISOString(),
          startedAt: null,
          provider: result.job.provider,
        }, ...current]);
        setNotice('Image generation queued. You can leave this page; processing continues on the server.');
        return;
      }
      const asset = result.asset;
      localAssetIds.current.add(asset.id);
      setAssets((current) => [{ id: asset.id, filename: asset.filename, type: asset.type, url: asset.url, generated: true }, ...current]);
      setSelected(asset.id);
      setNotice(simulated ? 'Simulated image saved to the Media Library.' : 'Image saved to the Media Library.');
    }, 'Image generation failed.');
  }

  function queue(kind: JobAction) {
    return run(kind, async () => {
      const needsInput = kind === 'IMAGE_VARIATION' || kind === 'VIDEO_ANIMATE';
      if (needsInput && !selected) throw new Error('Select a source image first.');
      const job = await createAiMediaJobAction(slug, {
        kind,
        prompt,
        inputAssetIds: needsInput && selected ? [selected] : [],
      });
      localJobIds.current.add(job.id);
      setJobs((current) => [{
        id: job.id,
        kind: job.kind,
        status: job.status,
        error: null,
        prompt,
        outputAssetId: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        provider: job.provider,
      }, ...current]);
      setNotice(`${AI_MEDIA_JOB_LABELS[kind]} queued. You can leave this page; processing continues on the server.`);
    }, 'The media job could not be queued.');
  }

  function cancel(jobId: string) {
    return run('CANCEL', async () => {
      await cancelAiMediaJobAction(slug, jobId);
      setJobs((current) => current.map((job) => job.id === jobId ? { ...job, status: 'CANCELLED' } : job));
      setNotice('Generation cancelled. No usage was recorded.');
    }, 'The generation could not be cancelled.');
  }

  function retry(job: Job) {
    return run('RETRY', async () => {
      const created = await retryAiMediaJobAction(slug, job.id, prompt);
      localJobIds.current.add(created.id);
      setJobs((current) => [{
        id: created.id,
        kind: created.kind,
        status: created.status,
        error: null,
        prompt,
        outputAssetId: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        provider: created.provider,
      }, ...current]);
      setNotice('Generation queued again with the current brief.');
    }, 'The generation could not be retried.');
  }

  function removeAsset() {
    if (!deleteTarget) return;
    return run('DELETE', async () => {
      await deleteGeneratedAssetAction(slug, deleteTarget.id);
      setAssets((current) => current.filter((asset) => asset.id !== deleteTarget.id));
      setJobs((current) => current.map((job) => job.outputAssetId === deleteTarget.id ? { ...job, outputAssetId: null } : job));
      if (selected === deleteTarget.id) setSelected(undefined);
      setDeleteTarget(undefined);
      setNotice('Generated asset deleted.');
    }, 'The generated asset could not be deleted.');
  }

  function editBrief(job: Job) {
    setPrompt(job.prompt);
    setNotice('Previous brief loaded. Edit it, then choose a generation action.');
    document.getElementById('studio-prompt')?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function elapsed(job: Job) {
    const seconds = Math.max(0, Math.floor((now - new Date(job.createdAt).getTime()) / 1000));
    return seconds < 60 ? `${seconds}s elapsed` : `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`;
  }

  const isPending = (action: Action) => pending.includes(action);

  return (
    <div className="space-y-6">
      <StatusMessage tone="neutral">
        {simulated
          ? 'Demo mode is active. Image, video, and audio results are labelled fixtures, not real model output.'
          : 'Generations run on the configured AI provider and are saved to the Media Library when complete.'}
      </StatusMessage>
      <section className="grid grid-cols-1 gap-6 rounded-[24px] bg-[var(--block-lilac)] p-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <TextArea
            id="studio-prompt"
            label="Creative brief"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="min-h-28"
          />
          <Dropdown
            label="Generate images with"
            containerClassName="mt-5"
            value={source}
            options={IMAGE_SOURCES}
            onChange={(value) => {
              const chosen = value as ImageProviderName;
              setSource(chosen);
              // 9:16 exists only on Codex, so leaving it selected while
              // switching to the API would send a shape it refuses.
              const nextSize = imageSizeAvailableFor(size, chosen) ? size : DEFAULT_IMAGE_SIZE;
              setSize(nextSize);
              writeStudioPrefs(slug, { source: chosen, size: nextSize });
            }}
          />
          <Dropdown
            label="Image shape"
            containerClassName="mt-5"
            value={size}
            options={IMAGE_SIZE_PRESETS.filter((preset) =>
              imageSizeAvailableFor(preset.id, source),
            ).map((preset) => ({
              value: preset.id,
              label: preset.label,
            }))}
            onChange={(value) => {
              setSize(value as ImageSize);
              writeStudioPrefs(slug, { source, size: value as ImageSize });
            }}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3 lg:min-w-56 lg:flex-col lg:items-stretch lg:justify-end">
          <Button type="button" onClick={() => generate('IMAGE')} disabled={isPending('IMAGE')} aria-busy={isPending('IMAGE')}>
            <ImageIcon size={16} /> <ActionLabel idle="Generate image" busy="Generating image" isBusy={isPending('IMAGE')} />
          </Button>
          <Button type="button" variant="secondary" onClick={() => queue('VIDEO_GENERATE')} disabled={isPending('VIDEO_GENERATE')} aria-busy={isPending('VIDEO_GENERATE')}>
            <Video size={16} /> <ActionLabel idle="Generate video" busy="Queuing video" isBusy={isPending('VIDEO_GENERATE')} />
          </Button>
          <Button type="button" variant="secondary" onClick={() => queue('AUDIO_TTS')} disabled={isPending('AUDIO_TTS')} aria-busy={isPending('AUDIO_TTS')}>
            <Mic2 size={16} /> <ActionLabel idle="Generate audio" busy="Queuing audio" isBusy={isPending('AUDIO_TTS')} />
          </Button>
          {selectedAsset?.type === 'IMAGE' && (
            <Button type="button" variant="secondary" onClick={() => queue('VIDEO_ANIMATE')} disabled={isPending('VIDEO_ANIMATE')} aria-busy={isPending('VIDEO_ANIMATE')}>
              <Video size={16} /> <ActionLabel idle="Animate selected image" busy="Queuing animation" isBusy={isPending('VIDEO_ANIMATE')} />
            </Button>
          )}
        </div>
        {/* Queued work is reported next to the controls that started it; the card at
            the foot of the page sits well below the fold and is the full history. */}
        {!!recentJobs.length && (
          <div className="rounded-md bg-canvas p-4 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="b88-caption">Latest jobs</p>
              {!!activeJobs.length && (
                <span className="flex items-center gap-2">
                  <span className="b88-spinner-inline" aria-hidden="true" />
                  <span className="b88-caption">Checking for updates</span>
                </span>
              )}
            </div>
            <div className="mt-3 space-y-4" aria-live="polite">
              {recentJobs.map((job) => (
                <div key={job.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {/* The brief, not the kind: three rows all reading
                        "Generated image" cannot be told apart. */}
                    <span className="min-w-0 flex-1 truncate text-sm font-[480]">
                      {job.prompt.trim() || AI_MEDIA_JOB_LABELS[job.kind]}
                    </span>
                    <span className="flex items-center gap-2">
                      {ACTIVE_STATUSES.includes(job.status) && <span className="b88-caption">{elapsed(job)}</span>}
                      <Badge tone={statusTone(job.status)}>{JOB_STATUS_LABELS[job.status]}</Badge>
                    </span>
                  </div>
                  {/* This strip is what people watch — it is above the fold and
                      the full panel is not. Finished rows keep the badge only. */}
                  {ACTIVE_STATUSES.includes(job.status) && <AiJobProgress job={job} now={now} />}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}

      <section>
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="b88-eyebrow">Generated assets</p><h2 className="b88-heading mt-2">Ready for a post</h2></div>
          {selected && <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => generate('REGENERATE', selected)} disabled={isPending('REGENERATE')} aria-busy={isPending('REGENERATE')}>
              <RefreshCw size={16} /> <ActionLabel idle="Regenerate" busy="Regenerating" isBusy={isPending('REGENERATE')} />
            </Button>
            <Button type="button" variant="secondary" onClick={() => queue('IMAGE_VARIATION')} disabled={isPending('IMAGE_VARIATION')} aria-busy={isPending('IMAGE_VARIATION')}>
              <ActionLabel idle="Create variation" busy="Queuing variation" isBusy={isPending('IMAGE_VARIATION')} />
            </Button>
            <Button href={`/w/${slug}/compose?asset=${selected}`}>Create post</Button>
            {selectedAsset?.generated && (
              <Button type="button" variant="secondary" onClick={() => setDeleteTarget(selectedAsset)}>
                <Trash2 size={16} /> Delete
              </Button>
            )}
          </div>}
        </div>
        {assets.length ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
            {visibleAssets.map((asset) => (
              <button key={asset.id} type="button" data-asset-id={asset.id} onClick={() => setSelected(asset.id)} className="relative grid min-h-28 grid-cols-[80px_minmax(0,1fr)] items-center gap-3 rounded-lg border bg-canvas p-3 text-left transition-opacity hover:opacity-80 sm:block sm:rounded-[24px] sm:p-4" style={{ borderColor: selected === asset.id ? 'var(--ink)' : 'var(--hairline)' }}>
                {selected === asset.id && <span className="absolute right-6 top-6 z-10 flex size-7 items-center justify-center rounded-full bg-ink text-canvas" aria-label="Selected"><Check size={16} /></span>}
                {asset.type === 'IMAGE' ? (
                  <img src={asset.url} alt={humanizeMachineValue(asset.filename)} className="size-20 rounded-md bg-surface-soft object-contain sm:aspect-square sm:size-auto sm:w-full" />
                ) : asset.type === 'VIDEO' && !simulated ? (
                  <video src={asset.url} controls className="aspect-video w-full rounded-md bg-surface-soft object-contain" onClick={(event) => event.stopPropagation()} />
                ) : asset.type === 'VIDEO' ? (
                  <div className="flex aspect-video items-center justify-center rounded-md bg-surface-soft p-4 text-center">
                    <span className="b88-caption">Simulated video fixture · no playable footage</span>
                  </div>
                ) : (
                  <div className="flex min-h-28 items-center rounded-md bg-surface-soft p-3" onClick={(event) => event.stopPropagation()}>
                    <audio src={asset.url} controls className="w-full" />
                  </div>
                )}
                <p className="min-w-0 truncate font-[480] sm:mt-4">
                  {humanizeMachineValue(asset.filename, {
                    sequence: assets.filter((entry, index) => index <= assets.indexOf(asset) && entry.filename === asset.filename).length,
                  })}
                </p>
                <p className="b88-caption col-start-2 mt-1 sm:mt-2">{asset.generated ? (simulated ? 'Simulated generation' : 'AI generated') : 'Source asset'}</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-6">
            <EmptyState eyebrow="Nothing generated yet" title="Start from a creative brief" />
          </div>
        )}
        {assets.length > 4 && (
          <div className="mt-5 flex justify-center">
            <Button type="button" variant="secondary" onClick={() => setShowAllAssets((current) => !current)}>
              {showAllAssets ? 'Show fewer assets' : `View all ${assets.length} assets`}
            </Button>
          </div>
        )}
      </section>

      <section className="b88-card">
        <p className="b88-eyebrow">Generation jobs</p>
        <div className="mt-4 divide-y divide-[var(--hairline-soft)]">
          {visibleJobs.map((job) => (
            <div key={job.id} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-[480]">{AI_MEDIA_JOB_LABELS[job.kind]}</span>
                <Badge tone={statusTone(job.status)}>{JOB_STATUS_LABELS[job.status]}</Badge>
              </div>
              <p className="mt-2 line-clamp-2 text-sm">{job.prompt}</p>
              {ACTIVE_STATUSES.includes(job.status) && <AiJobProgress job={job} now={now} />}
              {ACTIVE_STATUSES.includes(job.status) && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="b88-spinner-inline" aria-hidden="true" />
                    Total {elapsed(job)}
                  </span>
                  <Button type="button" variant="secondary" onClick={() => cancel(job.id)} disabled={isPending('CANCEL')}>
                    <X size={16} /> Cancel
                  </Button>
                </div>
              )}
              {/* The provider's own words, not a guess at them. "Review the
                  brief" is wrong and wastes the user's time when the real
                  cause is an expired credential or a rate limit, and those are
                  the failures worth acting on. */}
              {job.error && (
                <p className="mt-2 text-sm">
                  {job.error.trim() || 'The generation stopped before the media was ready. Review the brief and try again.'}
                </p>
              )}
              {!ACTIVE_STATUSES.includes(job.status) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(job.status === 'FAILED' || job.status === 'CANCELLED') && (
                    <Button type="button" variant="secondary" onClick={() => retry(job)} disabled={isPending('RETRY')}>Retry</Button>
                  )}
                  <Button type="button" variant="tertiary" onClick={() => editBrief(job)}>Modify brief</Button>
                  {job.outputAssetId && assets.some((asset) => asset.id === job.outputAssetId) && (
                    <>
                      <Button type="button" variant="secondary" onClick={() => setSelected(job.outputAssetId ?? undefined)}>Select result</Button>
                      <Button href={`/w/${slug}/compose?asset=${job.outputAssetId}`}>Create post</Button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {!visibleJobs.length && (
            <p className="py-4">
              {jobs.length ? 'Nothing generating right now.' : 'No generation jobs'}
            </p>
          )}
        </div>
        {jobs.length > sessionJobs.length && (
          <div className="mt-4 flex justify-center">
            <Button type="button" variant="secondary" onClick={() => setShowAllJobs((current) => !current)}>
              {showAllJobs ? 'Show this session' : `View all ${jobs.length} jobs`}
            </Button>
          </div>
        )}
      </section>

      <Dialog
        open={Boolean(deleteTarget)}
        eyebrow="Confirm deletion"
        title="Delete this generated asset?"
        onClose={() => setDeleteTarget(undefined)}
        actions={(
          <>
            <Button type="button" variant="secondary" onClick={() => setDeleteTarget(undefined)}>Keep asset</Button>
            <Button type="button" onClick={removeAsset} disabled={isPending('DELETE')}>
              <ActionLabel idle="Delete asset" busy="Deleting asset" isBusy={isPending('DELETE')} />
            </Button>
          </>
        )}
      >
        The file will be removed from AI studio and the Media Library. This cannot be undone.
      </Dialog>
    </div>
  );
}

/**
 * Per-workspace studio picks, in the browser that made them.
 *
 * localStorage rather than the database: this is one person's working
 * preference on one machine, not workspace configuration their teammates
 * should inherit. Every access is guarded — Safari's private mode throws on
 * read, and a corrupt value must not take the whole studio down with it.
 */
const PREFS_KEY = (slug: string) => `b88:studio:${slug}`;

function readStudioPrefs(slug: string): { source?: ImageProviderName; size?: ImageSize } {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY(slug));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { source?: unknown; size?: unknown };
    return {
      source: IMAGE_SOURCES.some((option) => option.value === parsed.source)
        ? (parsed.source as ImageProviderName)
        : undefined,
      // A shape that is no longer offered — or no longer valid for the saved
      // source — is dropped rather than restored into a request that fails.
      size: IMAGE_SIZE_PRESETS.some((preset) => preset.id === parsed.size)
        && imageSizeAvailableFor(parsed.size as string, parsed.source as ImageProviderName)
        ? (parsed.size as ImageSize)
        : undefined,
    };
  } catch {
    return {};
  }
}

function writeStudioPrefs(slug: string, prefs: { source: ImageProviderName; size: ImageSize }) {
  try {
    window.localStorage.setItem(PREFS_KEY(slug), JSON.stringify(prefs));
  } catch {
    // Storage disabled or full: the picks just do not outlive the page.
  }
}
