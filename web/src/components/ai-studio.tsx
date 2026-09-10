'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ImageIcon, Mic2, RefreshCw, Video } from 'lucide-react';
import { Badge, Button, EmptyState, StatusMessage } from '@/bridge88/components';
import { createAiMediaJobAction, generateStudioImageAction } from '@/app/actions/ai';

type Asset = { id: string; filename: string; type: string; url: string };
type Job = { id: string; kind: string; status: string; error: string | null };
type JobAction = 'IMAGE_VARIATION' | 'VIDEO_GENERATE' | 'VIDEO_ANIMATE' | 'AUDIO_TTS';
type Action = 'IMAGE' | 'REGENERATE' | JobAction;

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

export function AiStudio({ slug, initialAssets, initialJobs }: {
  slug: string;
  initialAssets: Asset[];
  initialJobs: Job[];
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('A clean editorial workspace for planning social content');
  const [size, setSize] = useState<'1024x1024' | '1024x1536' | '1536x1024'>('1024x1024');
  const [assets, setAssets] = useState(initialAssets);
  const [jobs, setJobs] = useState(initialJobs);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState('');
  // Pending is tracked per action so one request never disables or relabels the
  // controls that did not start it.
  const [pending, setPending] = useState<Action[]>([]);
  const localAssetIds = useRef(new Set<string>());
  const localJobIds = useRef(new Set<string>());

  const activeJobs = jobs.filter((job) => ACTIVE_STATUSES.includes(job.status));
  const recentJobs = jobs.slice(0, 3);

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
      setAssets((current) => [{ id: asset.id, filename: asset.filename, type: asset.type, url: asset.url }, ...current]);
      setSelected(asset.id);
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
      setJobs((current) => [{ id: job.id, kind: job.kind, status: job.status, error: null }, ...current]);
    }, 'The media job could not be queued.');
  }

  const isPending = (action: Action) => pending.includes(action);

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-1 gap-6 rounded-[24px] bg-[var(--block-lilac)] p-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <label className="b88-label" htmlFor="studio-prompt">Creative brief</label>
          <textarea id="studio-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="b88-input min-h-28" />
          <label className="mt-4 block">
            <span className="b88-label">Image format</span>
            <select value={size} onChange={(event) => setSize(event.target.value as typeof size)} className="b88-input">
              <option value="1024x1024">Square · 1:1</option>
              <option value="1024x1536">Portrait · 2:3</option>
              <option value="1536x1024">Landscape · 3:2</option>
            </select>
          </label>
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
                  <Badge tone={statusTone(job.status)}>{job.status.toLowerCase()}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}

      <section>
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="b88-eyebrow">Generated assets</p><h2 className="b88-heading mt-2">Ready for a post</h2></div>
          {selected && <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => generate('REGENERATE', selected)} disabled={isPending('REGENERATE')} aria-busy={isPending('REGENERATE')}>
              <RefreshCw size={16} /> <ActionLabel idle="Regenerate" busy="Regenerating" isBusy={isPending('REGENERATE')} />
            </Button>
            <Button type="button" variant="secondary" onClick={() => queue('IMAGE_VARIATION')} disabled={isPending('IMAGE_VARIATION')} aria-busy={isPending('IMAGE_VARIATION')}>
              <ActionLabel idle="Create variation" busy="Queuing variation" isBusy={isPending('IMAGE_VARIATION')} />
            </Button>
            <Button href={`/w/${slug}/compose?asset=${selected}`}>Attach to post</Button>
          </div>}
        </div>
        {assets.length ? (
          <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {assets.map((asset) => (
              <button key={asset.id} type="button" onClick={() => setSelected(asset.id)} className="relative rounded-[24px] border bg-canvas p-4 text-left transition-opacity hover:opacity-80" style={{ borderColor: selected === asset.id ? 'var(--ink)' : 'var(--hairline)' }}>
                {selected === asset.id && <span className="absolute right-6 top-6 z-10 flex size-7 items-center justify-center rounded-full bg-ink text-canvas" aria-label="Selected"><Check size={16} /></span>}
                {asset.type === 'IMAGE' ? <img src={asset.url} alt="" className="aspect-square w-full rounded-md bg-surface-soft object-contain" /> : <div className="flex aspect-video items-center justify-center rounded-md bg-surface-soft"><span className="b88-caption">{asset.type.toLowerCase()}</span></div>}
                <p className="mt-4 truncate font-[480]">{asset.filename}</p>
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
      </section>

      <section className="b88-card">
        <p className="b88-eyebrow">Generation jobs</p>
        <div className="mt-4 divide-y divide-[var(--hairline-soft)]">
          {jobs.map((job) => (
            <div key={job.id} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-[480]">{sentenceCase(job.kind)}</span>
                <Badge tone={statusTone(job.status)}>{job.status.toLowerCase()}</Badge>
              </div>
              {job.error && <p className="mt-2 text-sm">{job.error}</p>}
            </div>
          ))}
          {!jobs.length && <p className="py-4">Video and audio jobs appear here after they are queued.</p>}
        </div>
      </section>
    </div>
  );
}
