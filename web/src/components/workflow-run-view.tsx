'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronDown, Play } from 'lucide-react';
import type { WorkflowNodeRunStatus, WorkflowRunStatus } from '@prisma/client';
import { Badge, Button, Dialog, humanizeMachineValue, MediaFrame, StatusMessage, VideoPlayer } from '@/bridge88/components';
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
  url?: string | null;
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
  canRun,
}: {
  slug: string;
  workflowId: string;
  initial: RunStatus;
  /** Node ids grouped into dependency levels — what runs in parallel with what. */
  levels: string[][];
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
   */
  const [preview, setPreview] = useState<ProducedAsset | null>(null);
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

  function retry(nodeRunId: string) {
    setError('');
    startTransition(async () => {
      try {
        await retryNodeAction(slug, nodeRunId);
        etag.current = null;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That step could not be run again.');
      }
    });
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
                          .map((asset) => (
                            <button
                              key={asset.id}
                              type="button"
                              className="w-24 shrink-0 text-left transition-opacity hover:opacity-80"
                              onClick={() => setPreview(asset)}
                              title={humanizeMachineValue(asset.filename)}
                            >
                              <MediaFrame
                                ratio={asset.width && asset.height ? `${asset.width} / ${asset.height}` : '1:1'}
                                tone="mint"
                                type={asset.type === 'VIDEO' ? 'video' : 'image'}
                                src={asset.url ?? undefined}
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
                      <Link
                        href={`/w/${slug}/workflows/${workflowId}?view=steps&node=${encodeURIComponent(node.nodeId)}`}
                        className="b88-body-sm underline underline-offset-4"
                      >
                        {node.status === 'FAILED' ? 'Fix this step' : 'Step settings'}
                      </Link>
                      {/* Only once a step has finished: before that there is
                          nothing recorded to show. A disclosure rather than two
                          sentences — the chevron carries the open/closed state,
                          so the label can stay one steady word. */}
                      {isNodeTerminal(node.status) && node.hasOutput && (
                        <Button
                          type="button"
                          variant="tertiary"
                          onClick={() => toggleOutput(node.id)}
                          aria-expanded={Boolean(outputs[node.id]?.open)}
                          aria-busy={Boolean(outputs[node.id]?.loading)}
                        >
                          <ChevronDown
                            size={15}
                            className={`transition-transform ${outputs[node.id]?.open ? 'rotate-180' : ''}`}
                            aria-hidden="true"
                          />
                          Output
                        </Button>
                      )}
                      {canRun && isNodeTerminal(node.status) && node.status !== 'SUCCEEDED' && (
                        <Button variant="secondary" onClick={() => retry(node.id)} disabled={pending}>
                          Run this step again
                        </Button>
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
        Dialog is the kit's only modal — 24px card over the scrim — and the
        media sits in the kit's frame, so a generated 9:16 still is shown at
        its own ratio rather than letterboxed into a square.
      */}
      <Dialog
        open={Boolean(preview)}
        eyebrow={preview ? MEDIA_KIND[preview.type] ?? 'Media' : undefined}
        title={preview ? humanizeMachineValue(preview.filename) : undefined}
        width={560}
        onClose={() => setPreview(null)}
        actions={preview ? (
          <>
            <Button variant="secondary" size="sm" href={`/w/${slug}/media?asset=${encodeURIComponent(preview.id)}`}>
              Open in library
            </Button>
            <Button variant="primary" size="sm" onClick={() => setPreview(null)}>Close</Button>
          </>
        ) : undefined}
      >
        {preview && (preview.type === 'VIDEO' ? (
          <VideoPlayer
            src={preview.url ?? undefined}
            ratio={ratioOf(preview)}
          />
        ) : preview.type === 'AUDIO' ? (
          // No still worth showing, so the player is the whole preview.
          <audio src={preview.url ?? undefined} controls className="w-full" />
        ) : (
          <MediaFrame
            ratio={ratioOf(preview)}
            tone="mint"
            type="image"
            src={preview.url ?? undefined}
            alt={humanizeMachineValue(preview.filename)}
          />
        ))}
        {preview?.width && preview.height ? (
          <p className="b88-caption mt-3">{preview.width} × {preview.height}</p>
        ) : null}
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
  const known = new Map<string, string>();
  for (const node of previous.nodes) {
    for (const asset of node.produced ?? []) {
      if (asset.url) known.set(asset.id, asset.url);
    }
  }
  if (known.size === 0) return next;

  return {
    ...next,
    nodes: next.nodes.map((node) => ({
      ...node,
      produced: node.produced?.map((asset) => ({
        ...asset,
        url: known.get(asset.id) ?? asset.url,
      })),
    })),
  };
}
