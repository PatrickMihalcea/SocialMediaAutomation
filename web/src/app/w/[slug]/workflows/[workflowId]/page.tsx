import { Suspense } from 'react';
import Link from 'next/link';
import { Badge } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { formatInZone } from '@/lib/scheduling/time';
import { WorkflowCanvas } from '@/components/workflow-canvas';
import { WorkflowSchedule } from '@/components/workflow-schedule';
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from '@/lib/workflows/labels';

export const metadata = { title: 'Workflow' };

export default function WorkflowPage({
  params,
}: {
  params: Promise<{ slug: string; workflowId: string }>;
}) {
  return (
    <Suspense fallback={<div className="min-h-[600px]" />}>
      <WorkflowDetail params={params} />
    </Suspense>
  );
}

async function WorkflowDetail({
  params,
}: {
  params: Promise<{ slug: string; workflowId: string }>;
}) {
  const { slug, workflowId } = await params;
  const ctx = await requireWorkspace(slug, 'workflow:view');

  const workflow = await db.workflow.findFirst({
    where: { id: workflowId, workspaceId: ctx.workspace.id },
    include: {
      nodes: { orderBy: { createdAt: 'asc' } },
      edges: true,
      runs: {
        select: { id: true, status: true, startedAt: true, durationMs: true },
        orderBy: { createdAt: 'desc' },
        take: 8,
      },
    },
  });
  if (!workflow) throw notFound('That workflow no longer exists.');

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="b88-eyebrow">
            <Link href={`/w/${slug}/workflows`}>Workflows</Link>
          </p>
          <h1 className="b88-page-title mt-3">{workflow.name}</h1>
          {workflow.description && <p className="b88-body-sm mt-2 max-w-prose">{workflow.description}</p>}
        </div>
      </div>

      <WorkflowCanvas
        slug={slug}
        workflowId={workflow.id}
        canEdit={ctx.can('workflow:edit')}
        canRun={ctx.can('workflow:run')}
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

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {ctx.can('workflow:edit') && (
          <WorkflowSchedule
            slug={slug}
            workflow={{
              id: workflow.id,
              scheduleEnabled: workflow.scheduleEnabled,
              scheduleWeekdays: workflow.scheduleWeekdays,
              scheduleHour: workflow.scheduleHour,
              scheduleMinute: workflow.scheduleMinute,
              timezone: workflow.timezone,
            }}
          />
        )}

        <div>
          <p className="b88-eyebrow">Recent runs</p>
          {workflow.runs.length === 0 ? (
            <p className="b88-body-sm mt-3">This workflow has not run yet.</p>
          ) : (
            <ul className="mt-3 list-none space-y-2 p-0">
              {workflow.runs.map((run) => (
                <li key={run.id} className="border-b border-hairline-soft pb-2">
                  <Link
                    href={`/w/${slug}/workflows/${workflow.id}/runs/${run.id}`}
                    className="flex items-center justify-between gap-4 no-underline"
                  >
                    <span className="b88-caption">
                      {run.startedAt
                        ? formatInZone(run.startedAt, workflow.timezone, 'd LLL HH:mm')
                        : 'NOT STARTED'}
                      {run.durationMs ? ` · ${Math.round(run.durationMs / 1000)}S` : ''}
                    </span>
                    <Badge tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
