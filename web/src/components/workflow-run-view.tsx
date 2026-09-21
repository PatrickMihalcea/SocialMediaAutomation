'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Braces, ChevronLeft, ChevronRight, Play, SlidersHorizontal } from 'lucide-react';
import type { WorkflowNodeRunStatus, WorkflowRunStatus } from '@prisma/client';
import { Badge, Button, Dialog, IconButton, humanizeMachineValue, MediaFrame, StatusMessage, VideoPlayer } from '@/bridge88/components';
import { cancelRunAction, getNodeRunOutputAction, retryNodeAction } from '@/app/actions/workflows';
import { WorkflowNodeOutput } from '@/components/workflow-node-output';
import {
  NODE_STATUS_LABEL,
  NODE_STATUS_TONE,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  formatElapsed,
  isNodeTerminal,
  isRunTerminal,
} from '@/lib/workflows/labels';

interface ProducedAsset {
  id: string;
  filename: string;
  type: string;
  width?: number | null;
  height?: number | null;
  /** The still shown in the grid: a thumbnail where one exists. */
  url?: string | null;
  /** The asset itself, for the preview — a <video> cannot play a poster. */
  fullUrl?: string | null;
}

interface NodeRun {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: WorkflowNodeRunStatus;
  attempt: number;
  maxAttempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  /** Media this step emitted, in port then position order. */
  produced?: ProducedAsset[];
  /** Set by the draft and publish steps, which create a post. */
  post?: { id: string; awaitingApproval: boolean; releaseOnApproval: string | null } | null;
  /**
   * Whether this step recorded anything worth reading. False for a step whose
   * output is only the ids of things already on the row — a draft's post, a
   * generator's pictures — where the control would cost a click to show a uuid.
   */
  hasOutput?: boolean;
}

interface RunStatus {
  serverNow: number;
  run: {
    id: string;
    status: WorkflowRunStatus;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    error: string | null;
  };
  nodes: NodeRun[];
}

/**
 * Live run view.
 *
 * Two independent clocks, following the pattern already used by the AI studio:
 * a poll that fetches status only while something is still moving, and a 1Hz
 * local ticker that advances the elapsed timers between polls. Recomputing
 * elapsed on the server instead would make every timer stutter at the poll
 * interval.
 *
 * It polls a JSON endpoint rather than calling router.refresh(), because a full
 * RSC re-render would fight the graph layout this view shares with the canvas.
 */
export function WorkflowRunView({
  slug,
  workflowId,
  initial,
  levels,
  replay,
  canRun,
}: {
  slug: string;
  workflowId: string;
  initial: RunStatus;
  /** Node ids grouped into dependency levels — what runs in parallel with what. */
  levels: string[][];
  /** Per node id: what playing from it would re-run. Fixed for the run's graph. */
  replay: Record<string, { nodes: string[]; publishes: boolean }>;
  canRun: boolean;
}) {
  const [status, setStatus] = useState<RunStatus>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const etag = useRef<string | null>(null);
  /**
   * Per-step output, fetched the first time it is asked for and then kept.
   * A finished step's output never changes, so re-opening it costs nothing and
   * closing it does not discard what was already loaded.
   */
  /**
   * The asset shown in the preview dialog.
   *
   * Previously each thumbnail linked to the media library, which answered
   * "did this work" by leaving the run — and on a run still in flight, losing
   * the page you were watching. The picture is the answer, so it opens here.
   *
   * The whole set is held rather than the one clicked: a step that made eight
   * pictures is judged by looking through them, and closing and reopening a
   * dialog seven times is not looking through them.
   */
  const [preview, setPreview] = useState<{ assets: ProducedAsset[]; index: number } | null>(null);
  /** The step a play was asked for, held while the publish warning is up. */
  const [confirmPlay, setConfirmPlay] = useState<NodeRun | null>(null);
  const previewAsset = preview ? preview.assets[preview.index] ?? null : null;

  /**
   * The height available to the preview, measured rather than assumed.
   *
   * The dialog's width has to be derived from it: a 2:3 still capped at 64% of
   * a short window is about 380px wide, and a fixed 760px card around it is
   * mostly empty paper. Remeasured on resize so the card does not keep a width
   * that suited the old window.
   */
  const [viewportHeight, setViewportHeight] = useState(900);
  useEffect(() => {
    const measure = () => setViewportHeight(window.innerHeight);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  /**
   * Arrow keys step through the set.
   *
   * A gallery that can only be driven by clicking a 40px target is a gallery
   * nobody looks all the way through. Escape is the Dialog's own.
   */
  useEffect(() => {
    if (!preview || preview.assets.length < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // step reads the latest state through the updater, so it needs no dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.assets.length, Boolean(preview)]);
  /**
   * Wide enough for the picture and no wider. A portrait still in a card built
   * for a landscape one is the empty-margins look; clamped so a panorama cannot
   * fill the screen and a very tall still cannot collapse the card.
   */
  const previewHasStrip = Boolean(preview && preview.assets.length > 1);
  const previewWidth = previewAsset?.width && previewAsset.height
    ? Math.max(360, Math.min(900,
        Math.round(mediaHeight(viewportHeight, previewHasStrip) * (previewAsset.width / previewAsset.height))
          + DIALOG_CHROME))
    : 560;

  /** Wraps on purpose: a gallery that dead-ends at both edges makes you aim. */
  function step(delta: number) {
    setPreview((current) => {
      if (!current) return current;
      const count = current.assets.length;
      return { ...current, index: (current.index + delta + count) % count };
    });
  }

  const [outputs, setOutputs] = useState<Record<string, {
    open: boolean;
    loading: boolean;
    value?: unknown;
    error?: string;
  }>>({});

  function toggleOutput(nodeRunId: string) {
    const current = outputs[nodeRunId];
    if (current?.open) {
      setOutputs((all) => ({ ...all, [nodeRunId]: { ...current, open: false } }));
      return;
    }
    if (current && 'value' in current) {
      setOutputs((all) => ({ ...all, [nodeRunId]: { ...current, open: true } }));
      return;
    }
    setOutputs((all) => ({ ...all, [nodeRunId]: { open: true, loading: true } }));
    void getNodeRunOutputAction(slug, nodeRunId).then(
      (result) => setOutputs((all) => ({
        ...all,
        [nodeRunId]: { open: true, loading: false, value: result.output },
      })),
      (cause: unknown) => setOutputs((all) => ({
        ...all,
        [nodeRunId]: {
          open: true,
          loading: false,
          error: cause instanceof Error ? cause.message : 'The output could not be loaded.',
        },
      })),
    );
  }

  const active = !isRunTerminal(status.run.status);
  // Corrects for a client clock that disagrees with the server's.
  const skew = useRef(0);

  useEffect(() => {
    if (!active) return;
    const url = `/api/workspaces/${slug}/workflows/${workflowId}/runs/${initial.run.id}/status`;
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(url, {
          headers: etag.current ? { 'if-none-match': etag.current } : {},
        });
        if (response.status === 304 || cancelled) return;
        if (!response.ok) return;
        etag.current = response.headers.get('etag');
        const next = (await response.json()) as RunStatus;
        skew.current = next.serverNow - Date.now();
        setStatus((previous) => withStablePreviewUrls(previous, next));
      } catch {
        // A dropped poll is not worth surfacing; the next tick retries.
      }
    }

    void poll();
    const timer = window.setInterval(poll, status.run.status === 'QUEUED' ? 3000 : 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, slug, workflowId, initial.run.id, status.run.status]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const byId = useMemo(
    () => new Map(status.nodes.map((node) => [node.nodeId, node])),
    [status.nodes],
  );

  function elapsedFor(node: NodeRun): string {
    if (node.durationMs != null) return formatElapsed(node.durationMs);
    if (!node.startedAt) return '—';
    const end = node.finishedAt ? new Date(node.finishedAt).getTime() : now + skew.current;
    return formatElapsed(end - new Date(node.startedAt).getTime());
  }

  function runElapsed(): string {
    if (status.run.durationMs != null) return formatElapsed(status.run.durationMs);
    if (!status.run.startedAt) return '—';
    const end = status.run.finishedAt
      ? new Date(status.run.finishedAt).getTime()
      : now + skew.current;
    return formatElapsed(end - new Date(status.run.startedAt).getTime());
  }

  function cancel() {
    setError('');
    startTransition(async () => {
      try {
        await cancelRunAction(slug, status.run.id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That run could not be cancelled.');
      }
    });
  }

  function play(node: NodeRun) {
    setError('');
    setConfirmPlay(null);
    // Shown as waiting straight away, and the run marked as going again.
    //
    // Not decoration: polling only runs while the run is unfinished, so a view
    // left on a finished run has nothing watching it. Without this the steps
    // sat there saying Done until the page was reloaded by hand — the work had
    // started, the screen was just the last thing the server said.
    const affected = new Set(replay[node.nodeId]?.nodes ?? [node.nodeId]);
    setStatus((current) => ({
      ...current,
      run: { ...current.run, status: 'RUNNING', finishedAt: null, durationMs: null, error: null },
      nodes: current.nodes.map((row) => (affected.has(row.nodeId)
        ? {
          ...row,
          status: 'PENDING' as WorkflowNodeRunStatus,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          error: null,
          attempt: 0,
          hasOutput: false,
          produced: [],
          post: null,
        }
        : row)),
    }));
    etag.current = null;

    startTransition(async () => {
      try {
        await retryNodeAction(slug, node.id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That step could not be played again.');
        // Put back what the server last said, since nothing is running after all.
        setStatus(initial);
      }
    });
  }

  /** What the button says it will do, which is more than re-run one step. */
  function playLabel(node: NodeRun): string {
    const after = (replay[node.nodeId]?.nodes.length ?? 1) - 1;
    if (after <= 0) return 'Play this step again';
    return `Play from here — also runs the ${after} step${after === 1 ? '' : 's'} after it`;
  }

  /**
   * Straight to it, unless a Publish step is among what would re-run.
   *
   * Everything else a replay touches can be done again — a regenerated image
   * costs a regeneration. A published post cannot be unpublished, and the step
   * writes a new post each time rather than updating the one it made before, so
   * the second run is a second post on the channel.
   */
  function askToPlay(node: NodeRun) {
    if (replay[node.nodeId]?.publishes) setConfirmPlay(node);
    else play(node);
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-hairline p-6">
        <div className="flex items-center gap-4">
          <Badge tone={RUN_STATUS_TONE[status.run.status]}>
            {RUN_STATUS_LABEL[status.run.status]}
          </Badge>
          <span className="b88-caption">
            {status.nodes.filter((n) => n.status === 'SUCCEEDED').length} OF {status.nodes.length} DONE
            {' · '}
            {runElapsed()}
          </span>
        </div>
        {canRun && active && (
          <Button variant="secondary" onClick={cancel} disabled={pending}>
            Cancel run
          </Button>
        )}
      </div>

      {status.run.error && <StatusMessage tone="error">{status.run.error}</StatusMessage>}
      {error && <StatusMessage tone="error">{error}</StatusMessage>}

      {/*
        Grouped by dependency level: everything in one row has no dependency on
        anything else in that row, so the shape of the list is also the shape of
        what actually runs in parallel.
      */}
      <ol className="list-none space-y-6 p-0">
        {levels.map((level, index) => (
          <li key={index}>
            <p className="b88-caption">
              {level.length > 1 ? `STEP ${index + 1} · ${level.length} IN PARALLEL` : `STEP ${index + 1}`}
            </p>
            <ul className="mt-2 list-none space-y-2 p-0">
              {level.map((nodeId) => {
                const node = byId.get(nodeId);
                if (!node) return null;
                return (
                  <li
                    key={nodeId}
                    className="rounded-md border border-hairline p-4"
                    style={
                      node.status === 'RUNNING'
                        ? { borderColor: 'var(--ink)' }
                        : undefined
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Badge
                          tone={node.post?.awaitingApproval ? 'cream' : NODE_STATUS_TONE[node.status]}
                        >
                          {node.post?.awaitingApproval ? 'Waiting for you' : NODE_STATUS_LABEL[node.status]}
                        </Badge>
                        <span className="text-base">{node.nodeName}</span>
                      </div>
                      <span className="b88-caption">
                        {elapsedFor(node)}
                        {node.attempt > 1 ? ` · ATTEMPT ${node.attempt} OF ${node.maxAttempts}` : ''}
                      </span>
                    </div>
                    {node.error && (
                      <p className="b88-body-sm mt-3" role="alert">
                        {node.error}
                      </p>
                    )}
                    {/*
                      "Passed" on a publish step that has not published anything
                      is the most misleading thing this view could say. The step
                      genuinely succeeded — requireApproval is on, so its job was
                      to create the post and stop — but nothing goes out until
                      someone approves it, and that has to be stated here.
                    */}
                    {node.post?.awaitingApproval && (
                      <p className="b88-body-sm mt-3">
                        This step created the post and stopped there. Nothing has been sent yet
                        {node.post.releaseOnApproval === 'now'
                          ? ' — approving it publishes it straight away.'
                          : node.post.releaseOnApproval === 'queue'
                            ? ' — approving it puts it in the queue for the next posting time.'
                            : ' — and approving it will not publish it either; it still needs a time.'}
                      </p>
                    )}
                    {/*
                      Where this step leads. A run that finished is mostly
                      interesting for what it produced, and the whole point of
                      reading a failure is to go fix the step that failed — both
                      were previously dead ends that left you navigating by hand.
                    */}
                    {/*
                      The pictures themselves. Reading "View treehouse-3.png"
                      tells you a step finished; seeing the frame tells you
                      whether it did what you asked, which is the only question
                      anyone opens a run to answer.
                    */}
                    {!!(node.produced ?? []).some((asset) => asset.url) && (
                      <div className="mt-3 flex flex-wrap gap-3">
                        {(node.produced ?? [])
                          .filter((asset) => asset.url)
                          .slice(0, 8)
                          .map((asset, assetIndex, shown) => (
                            <button
                              key={asset.id}
                              type="button"
                              className="w-24 shrink-0 text-left transition-opacity hover:opacity-80"
                              onClick={() => setPreview({ assets: shown, index: assetIndex })}
                              title={humanizeMachineValue(asset.filename)}
                            >
                              <MediaFrame
                                ratio={asset.width && asset.height ? `${asset.width} / ${asset.height}` : '1:1'}
                                tone="mint"
                                type={asset.type === 'VIDEO' ? 'video' : 'image'}
                                src={asset.url ?? undefined}
                                // Some assets record a thumbnail that was never
                                // written; the file itself still shows.
                                fallbackSrc={asset.fullUrl ?? undefined}
                                alt={humanizeMachineValue(asset.filename)}
                                overlay={asset.type === 'VIDEO'
                                  ? <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                      <span className="flex size-9 items-center justify-center rounded-pill bg-[rgba(0,0,0,0.58)] text-white">
                                        <Play size={15} />
                                      </span>
                                    </span>
                                  : undefined}
                              />
                            </button>
                          ))}
                        {(node.produced?.length ?? 0) > 8 && (
                          <span className="b88-caption self-center">
                            +{(node.produced?.length ?? 0) - 8} more
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                      {node.post && (
                        <Link
                          href={`/w/${slug}/posts/${node.post.id}`}
                          className="b88-body-sm underline underline-offset-4"
                        >
                          {node.post.awaitingApproval ? 'Review and approve it' : 'Open the post'}
                        </Link>
                      )}
                      {/* Offered on any step, not just failures: the reason a
                          step did something unexpected is usually its settings.
                          view=steps is required, not cosmetic — the canvas only
                          mounts on that tab, so without it the link lands on
                          Runs and the node selection has nothing to select. */}
                      <IconButton
                        icon={SlidersHorizontal}
                        label={node.status === 'FAILED' ? 'Fix this step' : 'Step settings'}
                        href={`/w/${slug}/workflows/${workflowId}?view=steps&node=${encodeURIComponent(node.nodeId)}`}
                      />
                      {/* Only once a step has finished: before that there is
                          nothing recorded to show. */}
                      {isNodeTerminal(node.status) && node.hasOutput && (
                        <IconButton
                          icon={Braces}
                          label={outputs[node.id]?.open ? 'Hide the output' : 'Show the output'}
                          onClick={() => toggleOutput(node.id)}
                          aria-expanded={Boolean(outputs[node.id]?.open)}
                          aria-busy={Boolean(outputs[node.id]?.loading)}
                          pressed={Boolean(outputs[node.id]?.open)}
                        />
                      )}
                      {/* Every finished step once the run is over, not only the
                          ones that broke. Changing a label and playing from
                          there is the ordinary case; regenerating eight
                          pictures to reach it is not. */}
                      {canRun && !active && isNodeTerminal(node.status) && (
                        <IconButton
                          icon={Play}
                          label={playLabel(node)}
                          onClick={() => askToPlay(node)}
                          disabled={pending}
                        />
                      )}
                    </div>
                    {outputs[node.id]?.open && (
                      outputs[node.id]?.loading ? (
                        <p className="b88-caption mt-3">Loading the output</p>
                      ) : outputs[node.id]?.error ? (
                        <StatusMessage tone="error">{outputs[node.id]!.error}</StatusMessage>
                      ) : (
                        <WorkflowNodeOutput output={outputs[node.id]?.value} />
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>

      {/*
        The picture, at a size worth judging, without leaving the run.

        Sized by height, not width. A fixed-width dialog turns a 9:16 still into
        a column about a thousand pixels tall — it ran off the bottom of the
        screen and took the buttons with it. Height is the scarce dimension, so
        it is the one that is capped and the width follows the image's own
        shape.
      */}
      <Dialog
        open={Boolean(previewAsset)}
        eyebrow={previewAsset
          ? `${MEDIA_KIND[previewAsset.type] ?? 'Media'}${preview && preview.assets.length > 1 ? ` · ${preview.index + 1} of ${preview.assets.length}` : ''}`
          : undefined}
        title={previewAsset ? humanizeMachineValue(previewAsset.filename) : undefined}
        width={previewWidth}
        onClose={() => setPreview(null)}
        actions={previewAsset ? (
          <>
            <Button variant="secondary" size="sm" href={`/w/${slug}/media?asset=${encodeURIComponent(previewAsset.id)}`}>
              Open in library
            </Button>
            <Button variant="primary" size="sm" onClick={() => setPreview(null)}>Done</Button>
          </>
        ) : undefined}
      >
        {previewAsset && (
          <div className="relative mx-auto w-fit max-w-full">
            {previewAsset.type === 'VIDEO' ? (
              <VideoPlayer
                src={previewAsset.fullUrl ?? undefined}
                poster={previewAsset.url ?? undefined}
                ratio={ratioOf(previewAsset)}
                style={mediaFit(viewportHeight, previewHasStrip, ratioOf(previewAsset))}
              />
            ) : previewAsset.type === 'AUDIO' ? (
              <audio src={previewAsset.fullUrl ?? undefined} controls className="w-80 max-w-full" />
            ) : (
              <MediaFrame
                ratio={ratioOf(previewAsset)}
                tone="mint"
                type="image"
                /* The full picture here, not the thumbnail the grid shows:
                   this dialog exists to look at it properly. */
                src={previewAsset.fullUrl ?? previewAsset.url ?? undefined}
                alt={humanizeMachineValue(previewAsset.filename)}
                style={mediaFit(viewportHeight, previewHasStrip)}
              />
            )}

            {/*
              Over the media, as the kit documents for previous and next: the
              circular control at ~58% black. Flanking the picture rather than
              sitting under it, so looking through a set is one target the
              pointer never leaves.
            */}
            {preview && preview.assets.length > 1 && (
              <>
                <StepThrough side="left" label="Previous" onClick={() => step(-1)} />
                <StepThrough side="right" label="Next" onClick={() => step(1)} />
              </>
            )}
          </div>
        )}
        {preview && preview.assets.length > 1 && (
          // "See them all" is the other half of a carousel: the arrows move,
          // the strip says how many there are and which one is open.
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {preview.assets.map((asset, index) => (
              <button
                key={asset.id}
                type="button"
                aria-label={`Show ${humanizeMachineValue(asset.filename)}`}
                aria-current={index === preview.index}
                onClick={() => setPreview((current) => (current ? { ...current, index } : current))}
                className={`size-12 shrink-0 overflow-hidden rounded-md border transition-opacity hover:opacity-80 ${
                  index === preview.index ? 'border-ink' : 'border-hairline opacity-60'
                }`}
              >
                {asset.url && <img src={asset.url} alt="" className="size-full object-cover" />}
              </button>
            ))}
          </div>
        )}
        {previewAsset?.width && previewAsset.height ? (
          <p className="b88-caption mt-3 text-center">{previewAsset.width} × {previewAsset.height}</p>
        ) : null}
      </Dialog>

      {/* Asked only when a Publish step is among what would run again. Every
          other consequence of a replay can be undone by running it once more;
          a post on a channel cannot, and the step writes a new one rather than
          updating the post it made before. */}
      <Dialog
        open={Boolean(confirmPlay)}
        eyebrow="Play from here"
        title={confirmPlay ? `Run ${confirmPlay.nodeName} and everything after it?` : undefined}
        onClose={() => setConfirmPlay(null)}
        actions={confirmPlay ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmPlay(null)}>
              Leave it
            </Button>
            <Button onClick={() => play(confirmPlay)} disabled={pending}>
              Play from here
            </Button>
          </>
        ) : undefined}
      >
        <p className="b88-body">
          This also runs a Publish step, which writes a new post rather than
          replacing the one this run already made. Anything it publishes now is
          a second post on the channel.
        </p>
      </Dialog>
    </div>
  );
}

const MEDIA_KIND: Record<string, string> = {
  IMAGE: 'Image',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  GIF: 'GIF',
};

/** The asset's own shape, so nothing is letterboxed or cropped to fit a guess. */
function ratioOf(asset: ProducedAsset): string {
  return asset.width && asset.height ? `${asset.width} / ${asset.height}` : '1:1';
}

/**
 * The next status, reusing the preview URL already on screen for any asset that
 * still has one.
 *
 * Each poll signs fresh URLs, and a signed URL carries its own expiry, so the
 * string differs every time even when the picture does not. Taking it verbatim
 * changes every `src` twice a second and the browser refetches and flashes the
 * whole grid. The bytes behind a given asset id never change, so the first URL
 * seen for it is kept and only genuinely new assets take the one just signed.
 */
function withStablePreviewUrls(previous: RunStatus, next: RunStatus): RunStatus {
  const known = new Map<string, { url?: string | null; fullUrl?: string | null }>();
  for (const node of previous.nodes) {
    for (const asset of node.produced ?? []) {
      if (asset.url || asset.fullUrl) known.set(asset.id, { url: asset.url, fullUrl: asset.fullUrl });
    }
  }
  if (known.size === 0) return next;

  return {
    ...next,
    nodes: next.nodes.map((node) => ({
      ...node,
      produced: node.produced?.map((asset) => ({
        ...asset,
        url: known.get(asset.id)?.url ?? asset.url,
        // Kept for the same reason as the still, and it matters more: a fresh
        // signature mid-playback restarts the clip the person is watching.
        fullUrl: known.get(asset.id)?.fullUrl ?? asset.fullUrl,
      })),
    })),
  };
}

/** Side padding of the card, added to the media's own width. */
const DIALOG_CHROME = 48;

/**
 * How tall the media may be, so the whole card fits the window.
 *
 * Everything else in the card is fixed height — the scrim's padding, the
 * eyebrow and title, the dimensions line, the action row, and the filmstrip
 * when there is more than one asset — so the media takes what is left. Measured
 * against the real window because a fixed cap put the buttons off-screen on a
 * laptop, which is where this is actually read.
 */
function mediaHeight(viewportHeight: number, hasStrip: boolean): number {
  // Measured against the rendered card, not estimated: the scrim's own padding
  // (48), the eyebrow and title (110), the dimensions line (40), the action row
  // (72), and the filmstrip when shown (80).
  const chrome = 48 + 110 + 40 + 72 + (hasStrip ? 80 : 0);
  return Math.max(220, Math.min(viewportHeight - chrome, 620));
}

function mediaFit(viewportHeight: number, hasStrip: boolean, ratio?: string) {
  return {
    width: 'auto',
    height: `${mediaHeight(viewportHeight, hasStrip)}px`,
    maxWidth: '100%',
    margin: '0 auto',
    // The player's own frame is `width: 100%` of this element, and this one
    // sits in a shrink-to-fit column — so with only a height to go on it
    // resolved to nothing and the dialog opened on an empty space. The ratio
    // is what turns the fixed height into a width. Images need none: the
    // picture inside carries its own.
    ...(ratio ? { aspectRatio: ratio } : {}),
  } as const;
}

/** The documented previous/next control: a circle at ~58% black over the media. */
function StepThrough({
  side,
  label,
  onClick,
}: {
  side: 'left' | 'right';
  label: string;
  onClick: () => void;
}) {
  const Glyph = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-pill bg-[rgba(0,0,0,0.58)] text-white transition-opacity hover:opacity-80 active:scale-[.97] ${side === 'left' ? 'left-3' : 'right-3'}`}
    >
      <Glyph size={18} />
    </button>
  );
}
