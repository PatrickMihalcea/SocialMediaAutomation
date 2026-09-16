'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import type { WorkflowNodeRunStatus, WorkflowRunStatus } from '@prisma/client';
import { Badge, Button, humanizeMachineValue, StatusMessage } from '@/bridge88/components';
import { cancelRunAction, retryNodeAction } from '@/app/actions/workflows';
import {
  NODE_STATUS_LABEL,
  NODE_STATUS_TONE,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  formatElapsed,
  isNodeTerminal,
  isRunTerminal,
} from '@/lib/workflows/labels';

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
  produced?: { id: string; filename: string; type: string }[];
  /** Set by the draft and publish steps, which create a post. */
  post?: { id: string; awaitingApproval: boolean; releaseOnApproval: string | null } | null;
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
        setStatus(next);
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
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                      {(node.produced ?? []).slice(0, 3).map((asset) => (
                        <Link
                          key={asset.id}
                          href={`/w/${slug}/media?asset=${encodeURIComponent(asset.id)}`}
                          className="b88-body-sm underline underline-offset-4"
                        >
                          {asset.type === 'VIDEO' ? 'Watch' : 'View'} {humanizeMachineValue(asset.filename)}
                        </Link>
                      ))}
                      {(node.produced?.length ?? 0) > 3 && (
                        <span className="b88-caption">+{(node.produced?.length ?? 0) - 3} more</span>
                      )}
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
                      {canRun && isNodeTerminal(node.status) && node.status !== 'SUCCEEDED' && (
                        <Button variant="secondary" onClick={() => retry(node.id)} disabled={pending}>
                          Run this step again
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
