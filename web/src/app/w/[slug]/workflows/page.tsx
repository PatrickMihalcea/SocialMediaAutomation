import { Suspense } from 'react';
import Link from 'next/link';
import { Badge, EmptyState } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { formatInZone } from '@/lib/scheduling/time';
import { NewWorkflowForm } from '@/components/workflow-list';
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from '@/lib/workflows/labels';

export const metadata = { title: 'Workflows' };

export default function WorkflowsPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <>
      <div>
        <p className="b88-eyebrow">Automation</p>
        <h1 className="b88-page-title mt-3">Workflows</h1>
      </div>
      <Suspense fallback={<div className="mt-6 min-h-[420px]" />}>
        <WorkflowsData params={params} />
      </Suspense>
    </>
  );
}

async function WorkflowsData({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'workflow:view');

  const workflows = await db.workflow.findMany({
    where: { workspaceId: ctx.workspace.id, archivedAt: null },
    include: {
      _count: { select: { nodes: true } },
      runs: {
        select: { id: true, status: true, startedAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: [{ updatedAt: 'desc' }],
  });

  return (
    <div className="mt-6 min-h-[420px] space-y-8">
      {ctx.can('workflow:edit') && <NewWorkflowForm slug={slug} />}

      {workflows.length === 0 ? (
        <EmptyState eyebrow="No workflows yet" title="Build a pipeline once, then run it on a schedule">
          A workflow chains steps together — generate ideas, generate images, cut them to the beat of a
          track, label each cut, then draft or publish the result.
        </EmptyState>
      ) : (
        <ul className="grid list-none gap-4 p-0 md:grid-cols-2">
          {workflows.map((workflow) => {
            const last = workflow.runs[0];
            return (
              <li key={workflow.id} className="rounded-lg border border-hairline p-6">
                <Link href={`/w/${slug}/workflows/${workflow.id}`} className="no-underline">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="b88-card-title">{workflow.name}</h2>
                      {workflow.description && (
                        <p className="b88-body-sm mt-2 max-w-prose">{workflow.description}</p>
                      )}
                    </div>
                    {last && (
                      <Badge tone={RUN_STATUS_TONE[last.status]}>{RUN_STATUS_LABEL[last.status]}</Badge>
                    )}
                  </div>
                  <p className="b88-caption mt-4">
                    {workflow._count.nodes} {workflow._count.nodes === 1 ? 'STEP' : 'STEPS'}
                    {workflow.scheduleEnabled && workflow.nextRunAt
                      ? ` · NEXT ${formatInZone(workflow.nextRunAt, workflow.timezone, 'ccc d LLL HH:mm')}`
                      : ' · MANUAL'}
                    {last?.startedAt
                      ? ` · LAST RUN ${formatInZone(last.startedAt, workflow.timezone, 'd LLL HH:mm')}`
                      : ' · NEVER RUN'}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
