import 'server-only';
import {
  Prisma,
  WorkflowNodeRunStatus,
  WorkflowRunStatus,
  WorkflowRunTrigger,
  type WorkflowNodeRun,
} from '@prisma/client';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { PermanentJobError } from '@/lib/queue/runner';
import { backoffMs } from '@/lib/queue/types';
import { conflict, invalid, notFound } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { notify } from '@/lib/notifications/service';
import { assertAcyclic, descendantsOf, incomingEdges, indegrees } from '@/lib/workflows/graph';
import { buildSnapshot, readSnapshot, toGraph, type WorkflowSnapshot } from '@/lib/workflows/snapshot';
import { getDefinition, nodeRunConfigIssue, parseConfig } from '@/lib/workflows/definitions';
import { checkGraphTypes } from '@/lib/workflows/port-resolution';
import { getExecutor } from '@/lib/workflows/executors';
import { CancelledError, type NodeRunContext } from '@/lib/workflows/node-context';

/**
 * The workflow executor.
 *
 * Exactly-once execution rests on four independent layers, in the same spirit as
 * the publishing engine:
 *
 *  1. A `pendingDeps` counter decremented with UPDATE … RETURNING. Postgres takes
 *     a row lock, so when two upstream nodes finish at the same instant exactly
 *     one transaction observes the counter reach zero.
 *  2. A conditional claim moving PENDING → QUEUED; `count === 0` means we lost.
 *  3. `Job.dedupeKey`, unique per queue, collapses a duplicate enqueue.
 *  4. The handler re-claims QUEUED → RUNNING, so a redelivered job body is a
 *     no-op rather than a second execution.
 *
 * Scheduling always reads the run's frozen snapshot, never the live canvas.
 */

const STALE_NODE_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------- starting

export async function startWorkflowRun(input: {
  workflowId: string;
  workspaceId: string;
  userId?: string | null;
  trigger?: WorkflowRunTrigger;
  runInput?: Record<string, unknown>;
}): Promise<string> {
  const workflow = await db.workflow.findFirst({
    where: { id: input.workflowId, workspaceId: input.workspaceId },
    include: { nodes: true, edges: true },
  });
  if (!workflow) throw notFound('That workflow no longer exists.');
  if (workflow.archivedAt) throw invalid('Restore this workflow before running it.');
  // Pausing stops unattended work, not deliberate work. Someone editing a
  // paused copy still needs to run it to see what their edits produce.
  if (workflow.enabled === false && input.trigger === WorkflowRunTrigger.SCHEDULE) {
    throw invalid('Resume this workflow before it can run on its schedule.');
  }
  if (workflow.nodes.length === 0) {
    throw invalid('This workflow has no steps yet. Add at least one before running it.');
  }

  const snapshot = buildSnapshot(workflow.nodes, workflow.edges);
  const graph = toGraph(snapshot);
  assertAcyclic(graph);
  assertRunnable(snapshot);

  const degrees = indegrees(graph);

  const run = await db.$transaction(async (tx) => {
    const created = await tx.workflowRun.create({
      data: {
        workspaceId: input.workspaceId,
        workflowId: workflow.id,
        // A scheduled run has nobody signed in, so it is attributed to whoever
        // set the workflow up. That keeps AI usage billed to a real person and
        // gives the completion notification somewhere to go.
        triggeredById: input.userId ?? workflow.createdById,
        trigger: input.trigger ?? WorkflowRunTrigger.MANUAL,
        status: WorkflowRunStatus.RUNNING,
        graph: snapshot as unknown as Prisma.InputJsonValue,
        input: (input.runInput ?? {}) as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
    });

    await tx.workflowNodeRun.createMany({
      data: snapshot.nodes.map((node) => ({
        workspaceId: input.workspaceId,
        runId: created.id,
        nodeId: node.id,
        nodeType: node.type,
        nodeName: node.name,
        config: (node.config ?? {}) as Prisma.InputJsonValue,
        pendingDeps: degrees.get(node.id) ?? 0,
        maxAttempts: getDefinition(node.type)?.longRunning ? 2 : 3,
      })),
    });

    await tx.workflow.update({ where: { id: workflow.id }, data: { lastRunAt: new Date() } });
    return created;
  });

  await audit({
    workspaceId: input.workspaceId,
    userId: input.userId ?? null,
    action: 'workflow.run_started',
    entityType: 'workflow_run',
    entityId: run.id,
    metadata: { workflowId: workflow.id, nodes: snapshot.nodes.length },
  });

  // Roots have no dependencies, so they start immediately.
  const roots = await db.workflowNodeRun.findMany({
    where: { runId: run.id, pendingDeps: 0, status: WorkflowNodeRunStatus.PENDING },
    select: { id: true, workspaceId: true },
  });
  for (const root of roots) await claimAndEnqueue(root);

  return run.id;
}

/** Every required input port must be connected before a run is worth starting. */
function assertRunnable(snapshot: WorkflowSnapshot): void {
  const connected = new Set(snapshot.edges.map((e) => `${e.targetNodeId}:${e.targetPort}`));
  const problems: string[] = [];

  for (const node of snapshot.nodes) {
    const definition = getDefinition(node.type);
    if (!definition) {
      problems.push(`"${node.name}" is a step type this version no longer knows about.`);
      continue;
    }
    for (const port of definition.inputs) {
      if (port.required && !connected.has(`${node.id}:${port.id}`)) {
        problems.push(`"${node.name}" needs something connected to its ${port.label} input.`);
      }
    }
    const configIssue = nodeRunConfigIssue(node.type, node.name, node.config);
    if (configIssue) problems.push(configIssue);
  }

  // Catches a graph whose generic steps no longer resolve — e.g. a Pick one
  // that fed a publish step until its image list was rewired to a video list.
  const mistyped = checkGraphTypes(snapshot);
  if (mistyped) problems.push(mistyped.reason);

  if (problems.length) throw invalid(problems.join(' '));
}

// ---------------------------------------------------------------- claiming

async function claimAndEnqueue(nodeRun: { id: string; workspaceId: string }): Promise<void> {
  const claimed = await db.workflowNodeRun.updateMany({
    where: {
      id: nodeRun.id,
      status: WorkflowNodeRunStatus.PENDING,
      pendingDeps: { lte: 0 },
      // jobId must be null. This is the structural guarantee that one node run
      // is dispatched once: every path that legitimately re-runs a step clears
      // jobId first, so anything else — a double fan-out, a sweeper racing a
      // completion — finds a job already recorded and does nothing. The
      // dedupeKey below is a second line of defence, not the only one, because
      // runJob nulls it on every terminal transition.
      jobId: null,
      run: { status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] }, cancelledAt: null },
    },
    data: { status: WorkflowNodeRunStatus.QUEUED, queuedAt: new Date(), error: null },
  });
  // Lost the race, already dispatched, or the run was cancelled.
  if (claimed.count === 0) return;

  const jobId = await enqueue(
    'run-workflow-node',
    { nodeRunId: nodeRun.id },
    {
      workspaceId: nodeRun.workspaceId,
      // Retries belong to this engine, not the queue: a node stuck RUNNING
      // across five invisible attempts is unreadable on the canvas, and the
      // queue's generic budget is wrong for a step that costs money per call.
      maxAttempts: 1,
      // Scoped to the attempt, not just the node run: a retry is enqueued from
      // inside the job that is failing, so a key naming only the node run would
      // dedupe the retry against that still-RUNNING job and drop it, leaving the
      // step QUEUED with nothing behind it.
      dedupeKey: dispatchKey(nodeRun.id, 0),
    },
  );
  await db.workflowNodeRun.updateMany({ where: { id: nodeRun.id }, data: { jobId } });
}

/** One key per dispatch, so consecutive attempts never collapse into one. */
const dispatchKey = (nodeRunId: string, attempt: number) => `workflow-node:${nodeRunId}:${attempt}`;

/**
 * Re-dispatches a step that is allowed to run again. Clearing jobId is what
 * re-opens the claim above, so every retry path goes through here rather than
 * enqueueing directly.
 */
async function redispatch(
  nodeRun: { id: string; workspaceId: string; attempt?: number },
  runAt?: Date,
): Promise<void> {
  await db.workflowNodeRun.update({ where: { id: nodeRun.id }, data: { jobId: null } });
  const jobId = await enqueue(
    'run-workflow-node',
    { nodeRunId: nodeRun.id },
    {
      workspaceId: nodeRun.workspaceId,
      maxAttempts: 1,
      runAt,
      dedupeKey: dispatchKey(nodeRun.id, (nodeRun.attempt ?? 0) + 1),
    },
  );
  await db.workflowNodeRun.updateMany({ where: { id: nodeRun.id }, data: { jobId } });
}

// ---------------------------------------------------------------- running

export async function runWorkflowNode(nodeRunId: string): Promise<void> {
  const started = await db.workflowNodeRun.updateMany({
    where: { id: nodeRunId, status: WorkflowNodeRunStatus.QUEUED },
    data: {
      status: WorkflowNodeRunStatus.RUNNING,
      startedAt: new Date(),
      heartbeatAt: new Date(),
      attempt: { increment: 1 },
    },
  });
  // Already running, cancelled, or skipped by a failed ancestor.
  if (started.count === 0) return;

  const nodeRun = await db.workflowNodeRun.findUnique({
    where: { id: nodeRunId },
    include: { run: { include: { workflow: { select: { name: true } } } } },
  });
  if (!nodeRun) throw new PermanentJobError(`Workflow step ${nodeRunId} no longer exists`);

  const snapshot = readSnapshot(nodeRun.run.graph);
  const graph = toGraph(snapshot);

  try {
    const executor = await getExecutor(nodeRun.nodeType);
    if (!executor) {
      throw new PermanentJobError(`"${nodeRun.nodeName}" is a step type this version cannot run.`);
    }

    const inputs = await resolveInputs(nodeRun, graph);
    await db.workflowNodeRun.update({
      where: { id: nodeRunId },
      data: { input: inputs as Prisma.InputJsonValue },
    });

    const context = await buildContext(nodeRun, inputs);
    const output = await executor(context);

    await completeNode(nodeRun, output);
  } catch (error) {
    if (error instanceof CancelledError) {
      await db.workflowNodeRun.updateMany({
        where: { id: nodeRunId, status: WorkflowNodeRunStatus.RUNNING },
        data: { status: WorkflowNodeRunStatus.CANCELLED, finishedAt: new Date() },
      });
      await settleRun(nodeRun.runId);
      return;
    }
    await handleNodeFailure(nodeRun, snapshot, error);
    return;
  }

  await settleRun(nodeRun.runId);
}

/**
 * A node reads its inputs straight off its upstream node runs' `output`. With
 * one writer per input port, an edge's value *is* that output — a separate
 * edge-value table would be a copy that can only drift, and keeping the values
 * on the upstream rows is exactly what lets a single node be retried later
 * without re-running everything above it.
 */
async function resolveInputs(
  nodeRun: WorkflowNodeRun,
  graph: ReturnType<typeof toGraph>,
): Promise<Record<string, unknown>> {
  const edges = incomingEdges(graph, nodeRun.nodeId);
  if (edges.length === 0) return {};

  const upstream = await db.workflowNodeRun.findMany({
    where: { runId: nodeRun.runId, nodeId: { in: edges.map((e) => e.sourceNodeId) } },
    select: { nodeId: true, nodeName: true, output: true, status: true },
  });
  const byNode = new Map(upstream.map((u) => [u.nodeId, u]));

  const inputs: Record<string, unknown> = {};
  for (const edge of edges) {
    const source = byNode.get(edge.sourceNodeId);
    if (!source || source.status !== WorkflowNodeRunStatus.SUCCEEDED) {
      throw new PermanentJobError(
        `"${source?.nodeName ?? 'An earlier step'}" did not finish, so this step has nothing to work from.`,
      );
    }
    const output = (source.output ?? {}) as Record<string, unknown>;
    inputs[edge.targetPort] = output[edge.sourcePort];
  }
  return inputs;
}

async function buildContext(
  nodeRun: WorkflowNodeRun & {
    run: { workspaceId: string; triggeredById: string | null; workflow: { name: string } };
  },
  inputs: Record<string, unknown>,
): Promise<NodeRunContext> {
  return {
    workspaceId: nodeRun.workspaceId,
    runId: nodeRun.runId,
    nodeRunId: nodeRun.id,
    nodeId: nodeRun.nodeId,
    nodeName: nodeRun.nodeName,
    workflowName: nodeRun.run.workflow.name,
    userId: nodeRun.run.triggeredById,
    attempt: nodeRun.attempt,
    config: parseConfig(nodeRun.nodeType, nodeRun.config),
    inputs,
    // Partial output from an earlier attempt, so a batch node can skip the
    // items it already paid for instead of regenerating them.
    previousOutput: (nodeRun.output ?? null) as Record<string, unknown> | null,

    async assertNotCancelled() {
      const run = await db.workflowRun.findUnique({
        where: { id: nodeRun.runId },
        select: { cancelledAt: true },
      });
      if (run?.cancelledAt) throw new CancelledError();
    },

    async heartbeat() {
      await db.workflowNodeRun
        .update({ where: { id: nodeRun.id }, data: { heartbeatAt: new Date() } })
        .catch(() => {});
    },

    async saveProgress(partial) {
      await db.workflowNodeRun.update({
        where: { id: nodeRun.id },
        data: { output: partial as Prisma.InputJsonValue, heartbeatAt: new Date() },
      });
    },

    async emitAssets(port, assetIds) {
      if (assetIds.length === 0) return;
      await db.workflowNodeRunAsset.createMany({
        data: assetIds.map((mediaAssetId, position) => ({
          nodeRunId: nodeRun.id,
          mediaAssetId,
          port,
          position,
        })),
        skipDuplicates: true,
      });
    },
  };
}

// ---------------------------------------------------------------- completion

async function completeNode(nodeRun: WorkflowNodeRun, output: Record<string, unknown>): Promise<void> {
  const finishedAt = new Date();
  const durationMs = nodeRun.startedAt ? finishedAt.getTime() - nodeRun.startedAt.getTime() : null;

  const settled = await db.workflowNodeRun.updateMany({
    where: { id: nodeRun.id, status: WorkflowNodeRunStatus.RUNNING },
    data: {
      status: WorkflowNodeRunStatus.SUCCEEDED,
      output: output as Prisma.InputJsonValue,
      error: null,
      finishedAt,
      durationMs,
    },
  });
  if (settled.count === 0) return;

  await fanOut(nodeRun.runId, nodeRun.nodeId);
}

/**
 * Decrement each successor's dependency counter and read the result back in the
 * same statement. The row lock serialises concurrent decrements, so precisely
 * one caller sees a counter hit zero — which is the right to enqueue that node.
 *
 * `updateMany` cannot do this: it returns a count, not the rows, and re-reading
 * afterwards would reintroduce the race this closes.
 */
async function fanOut(runId: string, completedNodeId: string): Promise<void> {
  const run = await db.workflowRun.findUnique({ where: { id: runId }, select: { graph: true } });
  if (!run) return;

  const graph = toGraph(readSnapshot(run.graph));
  const successors = graph.edges
    .filter((e) => e.sourceNodeId === completedNodeId)
    .map((e) => e.targetNodeId);
  if (successors.length === 0) return;

  const ready = await db.$queryRaw<{ id: string; workspace_id: string; pending_deps: number }[]>`
    UPDATE workflow_node_runs
       SET pending_deps = pending_deps - 1,
           updated_at   = now()
     WHERE run_id  = ${runId}::uuid
       AND node_id = ANY(${[...new Set(successors)]}::uuid[])
       AND status  = 'PENDING'
    RETURNING id, workspace_id, pending_deps
  `;

  for (const row of ready) {
    if (row.pending_deps > 0) continue;
    await claimAndEnqueue({ id: row.id, workspaceId: row.workspace_id });
  }
}

async function handleNodeFailure(
  nodeRun: WorkflowNodeRun,
  snapshot: WorkflowSnapshot,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const permanent =
    error instanceof PermanentJobError ||
    (typeof error === 'object' && error !== null && 'retryable' in error && error.retryable === false);

  // Log the technical detail server-side; the row keeps the readable sentence.
  console.error('[workflow] step failed', {
    nodeRunId: nodeRun.id,
    type: nodeRun.nodeType,
    attempt: nodeRun.attempt,
    error,
  });

  if (!permanent && nodeRun.attempt < nodeRun.maxAttempts) {
    await db.workflowNodeRun.updateMany({
      where: { id: nodeRun.id, status: WorkflowNodeRunStatus.RUNNING },
      data: { status: WorkflowNodeRunStatus.QUEUED, error: message },
    });
    await redispatch(nodeRun, new Date(Date.now() + backoffMs(nodeRun.attempt)));
    return;
  }

  const finishedAt = new Date();
  const doomed = descendantsOf(toGraph(snapshot), nodeRun.nodeId);

  await db.$transaction(async (tx) => {
    const failed = await tx.workflowNodeRun.updateMany({
      where: { id: nodeRun.id, status: WorkflowNodeRunStatus.RUNNING },
      data: {
        status: WorkflowNodeRunStatus.FAILED,
        error: message,
        finishedAt,
        durationMs: nodeRun.startedAt ? finishedAt.getTime() - nodeRun.startedAt.getTime() : null,
      },
    });
    if (failed.count === 0) return;

    // Everything downstream can never run now. Marking it SKIPPED is what stops
    // the run hanging forever waiting on work that will never be queued.
    if (doomed.length) {
      await tx.workflowNodeRun.updateMany({
        where: {
          runId: nodeRun.runId,
          nodeId: { in: doomed },
          status: { in: [WorkflowNodeRunStatus.PENDING, WorkflowNodeRunStatus.QUEUED] },
        },
        data: { status: WorkflowNodeRunStatus.SKIPPED, finishedAt },
      });
    }
  });

  await settleRun(nodeRun.runId);
}

// ---------------------------------------------------------------- settling

/**
 * A run's status is derived from its steps, never accumulated. Called after
 * every terminal transition and from the sweeper, so a crash between "last step
 * finished" and "run marked finished" is self-healing.
 */
export async function settleRun(runId: string): Promise<void> {
  const counts = await db.workflowNodeRun.groupBy({
    by: ['status'],
    where: { runId },
    _count: { _all: true },
  });
  const by = Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>;

  const outstanding =
    (by.PENDING ?? 0) + (by.QUEUED ?? 0) + (by.RUNNING ?? 0);
  if (outstanding > 0) return;

  const status = by.CANCELLED
    ? WorkflowRunStatus.CANCELLED
    : by.FAILED
      ? WorkflowRunStatus.FAILED
      : WorkflowRunStatus.SUCCEEDED;

  const run = await db.workflowRun.findUnique({ where: { id: runId } });
  if (!run) return;

  const finishedAt = new Date();
  const settled = await db.workflowRun.updateMany({
    // Two final steps finishing together both land here; one wins.
    where: { id: runId, status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] } },
    data: {
      status,
      finishedAt,
      durationMs: run.startedAt ? finishedAt.getTime() - run.startedAt.getTime() : null,
    },
  });
  if (settled.count === 0) return;

  const workflow = await db.workflow.findUnique({
    where: { id: run.workflowId },
    select: { name: true, workspace: { select: { slug: true } } },
  });

  if (run.triggeredById) {
    await notify({
      workspaceId: run.workspaceId,
      userIds: [run.triggeredById],
      type: status === WorkflowRunStatus.SUCCEEDED ? 'MEDIA_PROCESSING_COMPLETE' : 'POST_FAILED',
      title:
        status === WorkflowRunStatus.SUCCEEDED
          ? `"${workflow?.name ?? 'Workflow'}" finished`
          : `"${workflow?.name ?? 'Workflow'}" did not finish`,
      body:
        status === WorkflowRunStatus.SUCCEEDED
          ? undefined
          : 'Open the run to see which step stopped and why.',
      href: `/w/${workflow?.workspace.slug ?? run.workspaceId}/workflows/${run.workflowId}/runs/${run.id}`,
    });
  }

  await audit({
    workspaceId: run.workspaceId,
    action: `workflow.run_${status.toLowerCase()}`,
    entityType: 'workflow_run',
    entityId: run.id,
    metadata: { workflowId: run.workflowId },
  });
}

// ---------------------------------------------------------------- control

export async function cancelWorkflowRun(runId: string, workspaceId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const cancelled = await tx.workflowRun.updateMany({
      where: {
        id: runId,
        workspaceId,
        status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] },
      },
      data: { status: WorkflowRunStatus.CANCELLED, cancelledAt: new Date(), finishedAt: new Date() },
    });
    if (cancelled.count === 0) {
      throw conflict('That run has already finished. Refresh to see how it went.');
    }

    const stopped = await tx.workflowNodeRun.findMany({
      where: {
        runId,
        status: { in: [WorkflowNodeRunStatus.PENDING, WorkflowNodeRunStatus.QUEUED] },
      },
      select: { id: true, jobId: true },
    });
    await tx.workflowNodeRun.updateMany({
      where: {
        runId,
        status: { in: [WorkflowNodeRunStatus.PENDING, WorkflowNodeRunStatus.QUEUED] },
      },
      data: { status: WorkflowNodeRunStatus.CANCELLED, finishedAt: new Date() },
    });

    // Defuse the transport rows too. runJob only claims QUEUED jobs, so a row
    // moved to CANCELLED is never executed even if BullMQ still delivers it.
    if (stopped.length) {
      await tx.job.updateMany({
        where: {
          queue: 'WORKFLOW',
          status: 'QUEUED',
          id: { in: stopped.flatMap((node) => node.jobId ? [node.jobId] : []) },
        },
        data: { status: 'CANCELLED', dedupeKey: null, completedAt: new Date() },
      });
    }
  });

  // Steps already RUNNING stop cooperatively at their next assertNotCancelled.
}

/**
 * Re-run one failed step and everything below it, without re-running the steps
 * above. Their outputs are still on their SUCCEEDED rows, which is the whole
 * reason inputs are resolved from upstream rows rather than copied onto edges.
 */
export async function retryWorkflowNode(nodeRunId: string, workspaceId: string): Promise<void> {
  const nodeRun = await db.workflowNodeRun.findFirst({
    where: { id: nodeRunId, workspaceId },
    include: { run: true },
  });
  if (!nodeRun) throw notFound('That step is no longer part of a run.');
  if (
    nodeRun.status !== WorkflowNodeRunStatus.FAILED &&
    nodeRun.status !== WorkflowNodeRunStatus.SKIPPED &&
    nodeRun.status !== WorkflowNodeRunStatus.CANCELLED
  ) {
    throw invalid('Only a step that failed, was skipped or was cancelled can be run again.');
  }

  const snapshot = readSnapshot(nodeRun.run.graph);
  const graph = toGraph(snapshot);
  const affected = [nodeRun.nodeId, ...descendantsOf(graph, nodeRun.nodeId)];

  await db.$transaction(async (tx) => {
    const claimed = await tx.workflowRun.updateMany({
      where: {
        id: nodeRun.runId,
        status: { in: [WorkflowRunStatus.FAILED, WorkflowRunStatus.CANCELLED, WorkflowRunStatus.SUCCEEDED] },
      },
      data: {
        status: WorkflowRunStatus.RUNNING,
        finishedAt: null,
        durationMs: null,
        error: null,
        cancelledAt: null,
      },
    });
    // A double click finds the run already RUNNING and does nothing.
    if (claimed.count === 0) throw conflict('That run is already going again.');

    const succeeded = await tx.workflowNodeRun.findMany({
      where: { runId: nodeRun.runId, status: WorkflowNodeRunStatus.SUCCEEDED },
      select: { nodeId: true },
    });
    const done = new Set(succeeded.map((s) => s.nodeId));

    for (const nodeId of affected) {
      // Dependencies still outstanding are upstreams that have not succeeded —
      // which for a resumed branch is usually none, so it starts immediately.
      // Distinct upstream nodes, matching how indegrees() seeds the counter —
      // a pair joined by two edges is still one dependency.
      const pending = new Set(
        graph.edges
          .filter((e) => e.targetNodeId === nodeId && !done.has(e.sourceNodeId))
          .map((e) => e.sourceNodeId),
      ).size;
      await tx.workflowNodeRun.updateMany({
        where: { runId: nodeRun.runId, nodeId },
        data: {
          status: WorkflowNodeRunStatus.PENDING,
          pendingDeps: pending,
          output: Prisma.DbNull,
          error: null,
          attempt: 0,
          startedAt: null,
          finishedAt: null,
          heartbeatAt: null,
          durationMs: null,
          jobId: null,
        },
      });
    }

    // Provenance for the discarded attempt goes; the MediaAssets themselves stay
    // in the library, since they may already be attached to a post.
    await tx.workflowNodeRunAsset.deleteMany({
      where: { nodeRun: { runId: nodeRun.runId, nodeId: { in: affected } } },
    });
  });

  const ready = await db.workflowNodeRun.findMany({
    where: {
      runId: nodeRun.runId,
      nodeId: { in: affected },
      status: WorkflowNodeRunStatus.PENDING,
      pendingDeps: { lte: 0 },
    },
    select: { id: true, workspaceId: true },
  });
  for (const row of ready) await claimAndEnqueue(row);
}

// ---------------------------------------------------------------- sweeping

/**
 * Repairs runs a dying worker left behind: steps claimed but never enqueued,
 * steps running with a stale heartbeat, and runs whose last step finished
 * between the status write and the settle.
 */
export async function sweepWorkflowRuns(): Promise<{ requeued: number; settled: number }> {
  let requeued = 0;

  const stale = await db.workflowNodeRun.findMany({
    where: {
      status: WorkflowNodeRunStatus.RUNNING,
      OR: [
        { heartbeatAt: { lt: new Date(Date.now() - STALE_NODE_MS) } },
        { heartbeatAt: null, startedAt: { lt: new Date(Date.now() - STALE_NODE_MS) } },
      ],
    },
    select: { id: true, workspaceId: true, attempt: true },
    take: 50,
  });
  for (const row of stale) {
    const reclaimed = await db.workflowNodeRun.updateMany({
      where: { id: row.id, status: WorkflowNodeRunStatus.RUNNING },
      data: { status: WorkflowNodeRunStatus.QUEUED },
    });
    if (reclaimed.count === 0) continue;
    await redispatch(row);
    requeued += 1;
  }

  // Claimed but never delivered: QUEUED for a while with no live job row.
  const orphaned = await db.workflowNodeRun.findMany({
    where: {
      status: WorkflowNodeRunStatus.QUEUED,
      queuedAt: { lt: new Date(Date.now() - 60_000) },
    },
    select: { id: true, workspaceId: true, jobId: true, attempt: true },
    take: 50,
  });
  for (const row of orphaned) {
    // Look the job up by the id recorded on the node run, not by dedupeKey:
    // runJob nulls dedupeKey on every terminal transition, so a dedupeKey
    // lookup finds nothing for a job that ran seconds ago and the sweeper would
    // dispatch the step a second time.
    const live = row.jobId
      ? await db.job.findFirst({
          where: { id: row.jobId, status: { in: ['QUEUED', 'RUNNING'] } },
          select: { id: true },
        })
      : null;
    if (live) continue;
    // No live job behind a QUEUED step: the dispatch was lost. This is the path
    // that recovers a retry dropped by any future dedupe mistake, so it must
    // stay reachable — it only runs where the sweeper runs.
    // A job that exists but has finished, while the node run is still QUEUED,
    // means the dispatch was lost. Anything else is left alone.
    await redispatch(row);
    requeued += 1;
  }

  const unsettled = await db.workflowRun.findMany({
    where: {
      status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] },
      nodeRuns: {
        none: {
          status: {
            in: [
              WorkflowNodeRunStatus.PENDING,
              WorkflowNodeRunStatus.QUEUED,
              WorkflowNodeRunStatus.RUNNING,
            ],
          },
        },
      },
    },
    select: { id: true },
    take: 50,
  });
  for (const run of unsettled) await settleRun(run.id);

  return { requeued, settled: unsettled.length };
}
