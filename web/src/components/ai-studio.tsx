'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ImageIcon, Mic2, RefreshCw, Trash2, Video, X } from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, Select, StatusMessage, TextArea } from '@/bridge88/components';
import {
  cancelAiMediaJobAction,
  createAiMediaJobAction,
  deleteGeneratedAssetAction,
  generateStudioImageAction,
  retryAiMediaJobAction,
} from '@/app/actions/ai';

type Asset = { id: string; filename: string; type: string; url: string; generated: boolean };
type Job = {
  id: string;
  kind: string;
  status: string;
  error: string | null;
  prompt: string;
  outputAssetId: string | null;
  createdAt: string;
};
type JobAction = 'IMAGE_VARIATION' | 'VIDEO_GENERATE' | 'VIDEO_ANIMATE' | 'AUDIO_TTS';
type Action = 'IMAGE' | 'REGENERATE' | 'CANCEL' | 'RETRY' | 'DELETE' | JobAction;

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING'];
// Jobs finish in the worker, so the page has to ask the server again to see the
// result. Four seconds is short enough to feel live and only runs while work is open.
const POLL_MS = 4000;

function sentenceCase(value: string) {
  const words = value.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

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

export function AiStudio({ slug, initialAssets, initialJobs, initialSourceAssetId, simulated }: {
  slug: string;
  initialAssets: Asset[];
  initialJobs: Job[];
  initialSourceAssetId?: string;
  simulated: boolean;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('A clean editorial workspace for planning social content');
  const [size, setSize] = useState<'1024x1024' | '1024x1536' | '1536x1024'>('1024x1024');
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
  const firstAssets = assets.slice(0, 6);
  const visibleAssets = showAllAssets || !selectedAsset || firstAssets.some((asset) => asset.id === selectedAsset.id)
    ? (showAllAssets ? assets : firstAssets)
    : [selectedAsset, ...firstAssets.slice(0, 5)];
  const visibleJobs = showAllJobs ? jobs : jobs.slice(0, 5);

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
      const asset = await generateStudioImageAction(slug, { prompt, size, sourceAssetId });
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
      }, ...current]);
      setNotice(`${sentenceCase(kind)} queued. You can leave this page; processing continues on the server.`);
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
    <div className="space-y-8">
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
          <Select
            label="Image format"
            containerClassName="mt-5"
            value={size}
            onChange={(event) => setSize(event.target.value as typeof size)}
          >
            <option value="1024x1024">Square · 1:1</option>
            <option value="1024x1536">Portrait · 2:3</option>
            <option value="1536x1024">Landscape · 3:2</option>
          </Select>
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
            <div className="mt-3 space-y-3" aria-live="polite">
              {recentJobs.map((job) => (
                <div key={job.id} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm font-[480]">{sentenceCase(job.kind)}</span>
                  <span className="flex items-center gap-2">
                    {ACTIVE_STATUSES.includes(job.status) && <span className="b88-caption">{elapsed(job)}</span>}
                    <Badge tone={statusTone(job.status)}>{sentenceCase(job.status)}</Badge>
                  </span>
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
          <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {visibleAssets.map((asset) => (
              <button key={asset.id} type="button" onClick={() => setSelected(asset.id)} className="relative rounded-[24px] border bg-canvas p-4 text-left transition-opacity hover:opacity-80" style={{ borderColor: selected === asset.id ? 'var(--ink)' : 'var(--hairline)' }}>
                {selected === asset.id && <span className="absolute right-6 top-6 z-10 flex size-7 items-center justify-center rounded-full bg-ink text-canvas" aria-label="Selected"><Check size={16} /></span>}
                {asset.type === 'IMAGE' ? (
                  <img src={asset.url} alt={asset.filename} className="aspect-square w-full rounded-md bg-surface-soft object-contain" />
                ) : asset.type === 'VIDEO' ? (
                  <video src={asset.url} controls className="aspect-video w-full rounded-md bg-surface-soft object-contain" onClick={(event) => event.stopPropagation()} />
                ) : (
                  <div className="flex min-h-28 items-center rounded-md bg-surface-soft p-3" onClick={(event) => event.stopPropagation()}>
                    <audio src={asset.url} controls className="w-full" />
                  </div>
                )}
                <p className="mt-4 truncate font-[480]">{asset.filename}</p>
                <p className="b88-caption mt-2">{asset.generated ? (simulated ? 'Simulated generation' : 'AI generated') : 'Source asset'}</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-6">
            <EmptyState eyebrow="Nothing generated yet" title="Start from a creative brief">
              Write the brief above and generate an image. Bridge88 keeps every asset here, ready to attach to a post.
            </EmptyState>
          </div>
        )}
        {assets.length > 6 && (
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
                <span className="font-[480]">{sentenceCase(job.kind)}</span>
                <Badge tone={statusTone(job.status)}>{sentenceCase(job.status)}</Badge>
              </div>
              <p className="mt-2 line-clamp-2 text-sm">{job.prompt}</p>
              {ACTIVE_STATUSES.includes(job.status) && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="b88-spinner-inline" aria-hidden="true" />
                    Processing on the server · {elapsed(job)}
                  </span>
                  <Button type="button" variant="secondary" onClick={() => cancel(job.id)} disabled={isPending('CANCEL')}>
                    <X size={16} /> Cancel
                  </Button>
                </div>
              )}
              {job.error && <p className="mt-2 text-sm">{job.error}</p>}
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
          {!jobs.length && <p className="py-4">Video and audio jobs appear here after they are queued.</p>}
        </div>
        {jobs.length > 5 && (
          <div className="mt-4 flex justify-center">
            <Button type="button" variant="secondary" onClick={() => setShowAllJobs((current) => !current)}>
              {showAllJobs ? 'Show recent jobs' : `View all ${jobs.length} jobs`}
            </Button>
          </div>
        )}
      </section>

      <section className="b88-card">
        <p className="b88-eyebrow">Available in this build</p>
        <h2 className="b88-heading mt-2">Generation scope</h2>
        <p className="mt-3">
          Image prompts, three image formats, source-image variations, text-to-video,
          image animation, and text-to-speech are connected. Advanced editing,
          background and object removal, outpainting, upscaling, trimming, thumbnails,
          captions, translation, dubbing, transcription, voice selection, and multi-result
          batches are not implemented yet, so this studio does not present inactive controls for them.
        </p>
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
