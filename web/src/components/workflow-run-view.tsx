'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { WorkflowNodeRunStatus, WorkflowRunStatus } from '@prisma/client';
import { Badge, Button, StatusMessage } from '@/bridge88/components';
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
                        <Badge tone={NODE_STATUS_TONE[node.status]}>
                          {NODE_STATUS_LABEL[node.status]}
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
                    {canRun && isNodeTerminal(node.status) && node.status !== 'SUCCEEDED' && (
                      <div className="mt-3">
                        <Button variant="secondary" onClick={() => retry(node.id)} disabled={pending}>
                          Run this step again
                        </Button>
                      </div>
                    )}
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
