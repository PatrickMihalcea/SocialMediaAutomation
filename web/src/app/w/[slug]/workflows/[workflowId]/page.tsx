import { Suspense } from 'react';
import Link from 'next/link';
import { Badge, Button, EmptyState } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { resolveImageProviderName } from '@/lib/ai/provider-selection';
import { notFound } from '@/lib/errors';
import { formatInZone, timezoneLabel, WEEKDAY_SHORT } from '@/lib/scheduling/time';
import { toGraph } from '@/lib/workflows/snapshot';
import { topoOrder } from '@/lib/workflows/graph';
import { WorkflowCanvasLoader } from '@/components/workflow-canvas-loader';
import { WorkflowSchedule } from '@/components/workflow-schedule';
import { WorkflowTabs } from '@/components/workflow-tabs';
import { WorkflowRunsChart } from '@/components/workflow-runs-chart';
import { WorkflowRunsTable } from '@/components/workflow-runs-table';
import { RunWorkflowButton } from '@/components/workflow-run-button';
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from '@/lib/workflows/labels';
import { WorkflowListItemActions, WorkflowPauseToggle } from '@/components/workflow-list';

export const metadata = { title: 'Workflow' };

/** Enough history to see a pattern without turning the chart into a hairline comb. */
const HISTORY = 40;

export default function WorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; workflowId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  return (
    <Suspense fallback={<div className="min-h-[600px]" />}>
      <WorkflowDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function WorkflowDetail({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; workflowId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug, workflowId } = await params;
  const view = (await searchParams).view === 'steps' ? 'steps' : 'runs';
  const ctx = await requireWorkspace(slug, 'workflow:view');

  const [workflow, socialAccounts, audioAssets, mediaAssets, mediaFolders, mediaCountRows] = await Promise.all([
    db.workflow.findFirst({
      where: { id: workflowId, workspaceId: ctx.workspace.id },
      include: {
        nodes: { orderBy: { createdAt: 'asc' } },
        edges: true,
        createdBy: { select: { name: true, email: true } },
        runs: {
          orderBy: { createdAt: 'desc' },
          take: HISTORY,
          include: {
            nodeRuns: {
              select: { nodeId: true, status: true, durationMs: true },
            },
          },
        },
      },
    }),
    db.socialAccount.findMany({
      where: { workspaceId: ctx.workspace.id, status: 'ACTIVE' },
      select: { id: true, accountName: true, accountHandle: true, platform: true },
      orderBy: { accountName: 'asc' },
    }),
    db.mediaAsset.findMany({
      where: { workspaceId: ctx.workspace.id, status: 'READY', type: 'AUDIO' },
      select: { id: true, filename: true, folderId: true, bpm: true, beatGrid: true },
      orderBy: { filename: 'asc' },
    }),
    db.mediaAsset.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        status: 'READY',
        type: { in: ['IMAGE', 'VIDEO', 'AUDIO'] },
      },
      select: { id: true, filename: true, folderId: true, type: true },
      orderBy: [{ type: 'asc' }, { filename: 'asc' }],
      take: 1000,
    }),
    db.mediaFolder.findMany({
      where: { workspaceId: ctx.workspace.id },
      select: { id: true, name: true, parentId: true },
      orderBy: { name: 'asc' },
    }),
    db.mediaAsset.groupBy({
      by: ['folderId', 'type'],
      where: {
        workspaceId: ctx.workspace.id,
        status: 'READY',
        type: { in: ['IMAGE', 'VIDEO', 'AUDIO'] },
      },
      _count: { _all: true },
    }),
  ]);
  if (!workflow) throw notFound('That workflow no longer exists.');

  const mediaCounts = { images: 0, videos: 0, audio: 0 };
  const folderCounts = new Map(
    mediaFolders.map((folder) => [
      folder.id,
      { images: 0, videos: 0, audio: 0 },
    ]),
  );
  for (const row of mediaCountRows) {
    const key = row.type === 'IMAGE' ? 'images' : row.type === 'VIDEO' ? 'videos' : 'audio';
    mediaCounts[key] += row._count._all;
    if (row.folderId) {
      const counts = folderCounts.get(row.folderId);
      if (counts) counts[key] += row._count._all;
    }
  }

  // Lanes follow execution order, so the swimlanes read top-to-bottom the way
  // the pipeline actually runs rather than in whatever order rows were created.
  const graph = toGraph({
    version: 1,
    nodes: workflow.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      config: n.config,
      version: n.version,
      positionX: n.positionX,
      positionY: n.positionY,
    })),
    edges: workflow.edges.map((e) => ({
      sourceNodeId: e.sourceNodeId,
      sourcePort: e.sourcePort,
      targetNodeId: e.targetNodeId,
      targetPort: e.targetPort,
    })),
  });
  const order = safeOrder(graph, workflow.nodes.map((n) => n.id));
  const lanes = order
    .map((id) => workflow.nodes.find((n) => n.id === id))
    .filter((n): n is (typeof workflow.nodes)[number] => Boolean(n))
    .map((n) => ({ id: n.id, name: n.name }));

  // Oldest first for the chart, newest first for the table.
  const chronological = [...workflow.runs].reverse();
  const last = workflow.runs[0];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="b88-eyebrow">
            <Link href={`/w/${slug}/workflows`}>Workflows</Link>
          </p>
          <h1 className="b88-page-title mt-3">{workflow.name}</h1>
          {workflow.description && (
            <p className="b88-body-sm mt-2 max-w-prose">{workflow.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button href={`/w/${slug}/workflows/guide`} variant="secondary">Guide</Button>
          {workflow.archivedAt
            ? <Badge tone="neutral">Archived</Badge>
            : !workflow.enabled && (
              <>
                <Badge tone="neutral">Schedule paused</Badge>
                {ctx.can('workflow:edit') && (
                  <WorkflowPauseToggle
                    slug={slug}
                    workflowId={workflow.id}
                    enabled={workflow.enabled}
                  />
                )}
              </>
            )}
          {last && <Badge tone={RUN_STATUS_TONE[last.status]}>{RUN_STATUS_LABEL[last.status]}</Badge>}
          {ctx.can('workflow:edit') && (
            <WorkflowListItemActions
              slug={slug}
              workflow={{
                id: workflow.id,
                name: workflow.name,
                description: workflow.description,
                enabled: workflow.enabled,
                archived: Boolean(workflow.archivedAt),
              }}
            />
          )}
          {ctx.can('workflow:run') && (
            <RunWorkflowButton
              slug={slug}
              workflowId={workflow.id}
              disabled={workflow.nodes.length === 0 || Boolean(workflow.archivedAt)}
            />
          )}
        </div>
      </div>

      <WorkflowTabs base={`/w/${slug}/workflows/${workflow.id}`} active={view} />

      {/* The canvas wants the whole width — squeezed into a column its nodes
          clip and its own palette and settings rail have nowhere to sit. The
          details move underneath it instead of fighting it for room. */}
      {view === 'steps' ? (
        <>
          <div className="mt-6">
            <WorkflowCanvasLoader
              slug={slug}
              workflowId={workflow.id}
              canEdit={ctx.can('workflow:edit') && !workflow.archivedAt}
              // A mocked image provider overrides the per-step switch, so the
              // canvas has to know about it or its Mock badges would lie.
              mediaProviderMocked={
                resolveImageProviderName(env.AI_PROVIDER, env.AI_IMAGE_PROVIDER) === 'mock'
              }
              accounts={socialAccounts}
              audioAssets={audioAssets.map((asset) => ({
                id: asset.id,
                filename: asset.filename,
                folderId: asset.folderId,
                bpm: asset.bpm,
                hasBeatGrid: asset.beatGrid.length > 1,
              }))}
              mediaAssets={mediaAssets}
              mediaFolders={mediaFolders.map((folder) => ({
                ...folder,
                counts: folderCounts.get(folder.id)!,
              }))}
              mediaCounts={mediaCounts}
              initialNodes={workflow.nodes.map((node) => ({
                id: node.id,
                type: node.type,
                name: node.name,
                config: node.config,
                positionX: node.positionX,
                positionY: node.positionY,
              }))}
              initialEdges={workflow.edges.map((edge) => ({
                id: edge.id,
                sourceNodeId: edge.sourceNodeId,
                sourcePort: edge.sourcePort,
                targetNodeId: edge.targetNodeId,
                targetPort: edge.targetPort,
              }))}
            />
          </div>

          <div className="mt-10 grid gap-10 lg:grid-cols-2">
            <WorkflowDetails workflow={workflow} timezone={ctx.workspace.timezone} lastRun={last} />
            {ctx.can('workflow:edit') && !workflow.archivedAt && (
              <WorkflowSchedule
                slug={slug}
                timezone={ctx.workspace.timezone}
                workflow={{
                  id: workflow.id,
                  scheduleEnabled: workflow.scheduleEnabled,
                  scheduleWeekdays: workflow.scheduleWeekdays,
                  scheduleHour: workflow.scheduleHour,
                  scheduleMinute: workflow.scheduleMinute,
                }}
              />
            )}
          </div>
        </>
      ) : (
        <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {workflow.runs.length === 0 ? (
              <EmptyState eyebrow="No runs yet" title="Nothing has gone through this workflow">
                Run it once and this fills with a bar per run, and a lane per step showing where
                each one got to.
              </EmptyState>
            ) : (
              <>
                <WorkflowRunsChart
                  slug={slug}
                  workflowId={workflow.id}
                  timezone={ctx.workspace.timezone}
                  lanes={lanes}
                  runs={chronological.map((run) => ({
                    id: run.id,
                    status: run.status,
                    startedAt: run.startedAt?.toISOString() ?? null,
                    durationMs: run.durationMs,
                    trigger: run.trigger,
                    error: run.error,
                    nodes: run.nodeRuns.map((node) => ({
                      nodeId: node.nodeId,
                      status: node.status,
                      durationMs: node.durationMs,
                    })),
                  }))}
                />
                <WorkflowRunsTable
                  slug={slug}
                  workflowId={workflow.id}
                  timezone={ctx.workspace.timezone}
                  runs={workflow.runs.map((run) => ({
                    id: run.id,
                    status: run.status,
                    startedAt: run.startedAt,
                    durationMs: run.durationMs,
                    trigger: run.trigger,
                    error: run.error,
                    stepsTotal: run.nodeRuns.length,
                    stepsDone: run.nodeRuns.filter((n) => n.status === 'SUCCEEDED').length,
                  }))}
                />
              </>
            )}
          </div>

          <aside className="space-y-8">
            <WorkflowDetails workflow={workflow} timezone={ctx.workspace.timezone} lastRun={last} />

            <section>
              <p className="b88-eyebrow">Schedule</p>
              <p className="b88-body-sm mt-3">
                {describeSchedule(workflow, ctx.workspace.timezone)}
              </p>
            </section>

            {ctx.can('workflow:edit') && (
              <Button variant="secondary" href={`/w/${slug}/workflows/${workflow.id}?view=steps`}>
                Edit the pipeline
              </Button>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function WorkflowDetails({
  workflow,
  timezone,
  lastRun,
}: {
  workflow: {
    id: string;
    nodes: unknown[];
    edges: unknown[];
    createdBy: { name: string | null; email: string } | null;
  };
  // The workspace zone, never the workflow's mirrored column: a row written
  // before the zone moved would otherwise report the old one.
  timezone: string;
  lastRun?: { startedAt: Date | null };
}) {
  return (
    <section>
      <p className="b88-eyebrow">Workflow details</p>
      <dl className="mt-4 space-y-3 text-sm">
        <Detail label="Workflow ID" value={workflow.id.slice(0, 8)} mono />
        <Detail
          label="Creator"
          value={workflow.createdBy?.name ?? workflow.createdBy?.email ?? 'Unknown'}
        />
        <Detail label="Steps" value={String(workflow.nodes.length)} />
        <Detail label="Connections" value={String(workflow.edges.length)} />
        <Detail
          label="Last run"
          value={
            lastRun?.startedAt ? formatInZone(lastRun.startedAt, timezone, 'd LLL HH:mm') : 'Never'
          }
        />
        <Detail label="Timezone" value={timezoneLabel(timezone)} />
      </dl>
    </section>
  );
}

function describeSchedule(
  workflow: {
    scheduleEnabled: boolean;
    scheduleWeekdays: number[];
    scheduleHour: number;
    scheduleMinute: number;
    nextRunAt: Date | null;
  },
  timezone: string,
): string {
  if (!workflow.scheduleEnabled || workflow.scheduleWeekdays.length === 0) {
    return 'Runs manually only.';
  }
  const days = workflow.scheduleWeekdays.map((day) => WEEKDAY_SHORT[day]).join(', ');
  const at = `${String(workflow.scheduleHour).padStart(2, '0')}:${String(workflow.scheduleMinute).padStart(2, '0')}`;
  const next = workflow.nextRunAt
    ? ` Next ${formatInZone(workflow.nextRunAt, timezone, 'd LLL HH:mm')}.`
    : '';
  return `${days} at ${at}.${next}`;
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline-soft pb-3">
      <dt className="b88-caption">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : 'text-right'}>{value}</dd>
    </div>
  );
}

/** A graph edited into a cycle must still render its history, not throw. */
function safeOrder(graph: Parameters<typeof topoOrder>[0], fallback: string[]): string[] {
  try {
    return topoOrder(graph);
  } catch {
    return fallback;
  }
}
