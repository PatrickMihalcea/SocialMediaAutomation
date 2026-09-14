import { Suspense } from 'react';
import Link from 'next/link';
import { Badge, Button, EmptyState } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { formatInZone } from '@/lib/scheduling/time';
import { NewWorkflowForm, WorkflowListItemActions } from '@/components/workflow-list';
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from '@/lib/workflows/labels';

export const metadata = { title: 'Workflows' };

export default async function WorkflowsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="b88-eyebrow">Automation</p>
          <h1 className="b88-page-title mt-3">Workflows</h1>
        </div>
        <Button href={`/w/${slug}/workflows/guide`} variant="secondary">Workflow guide</Button>
      </div>
      <Suspense fallback={<div className="mt-6 min-h-[420px]" />}>
        <WorkflowsData slug={slug} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function WorkflowsData({
  slug,
  searchParams,
}: {
  slug: string;
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await requireWorkspace(slug, 'workflow:view');
  const archivedOnly = (await searchParams).view === 'archived';

  const workflows = await db.workflow.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      archivedAt: archivedOnly ? { not: null } : null,
    },
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
      <nav className="flex flex-wrap gap-3" aria-label="Workflow views">
        <Button
          href={`/w/${slug}/workflows`}
          variant={archivedOnly ? 'secondary' : 'primary'}
        >
          Current
        </Button>
        <Button
          href={`/w/${slug}/workflows?view=archived`}
          variant={archivedOnly ? 'primary' : 'secondary'}
        >
          Archived
        </Button>
      </nav>

      {!archivedOnly && ctx.can('workflow:edit') && ctx.can('ai:use') && (
        <section className="rounded-lg bg-[var(--block-lilac)] p-6">
          <p className="b88-eyebrow">Recommended</p>
          <h2 className="b88-card-title mt-3">Describe the outcome. Review the graph.</h2>
          <p className="b88-body-sm mt-2 max-w-2xl">
            The assistant can choose steps, connect compatible ports, configure formats, and add a
            schedule. Nothing is created until you confirm the proposed workflow.
          </p>
          <div className="mt-4">
            <Button href={`/w/${slug}/assistant`}>Build with the assistant</Button>
          </div>
        </section>
      )}

      {!archivedOnly && ctx.can('workflow:edit') && <NewWorkflowForm slug={slug} />}

      {workflows.length === 0 ? (
        <EmptyState
          eyebrow={archivedOnly ? 'No archived workflows' : 'No workflows yet'}
          title={archivedOnly ? 'Archived workflows appear here' : 'Build a pipeline once, then run it on a schedule'}
        >
          {archivedOnly
            ? 'Archive a workflow when you want it out of the active list without deleting its graph or run history.'
            : 'A workflow chains steps together — generate ideas, generate images, cut them to the beat of a track, label each cut, then draft or publish the result.'}
        </EmptyState>
      ) : (
        <ul className="grid list-none gap-4 p-0 md:grid-cols-2">
          {workflows.map((workflow) => {
            const last = workflow.runs[0];
            return (
              <li key={workflow.id} className="rounded-lg border border-hairline p-6">
                <div className="flex items-start gap-4">
                  <Link
                    href={`/w/${slug}/workflows/${workflow.id}`}
                    className="min-w-0 flex-1 no-underline"
                  >
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
                    {!workflow.enabled
                      ? ' · SCHEDULE PAUSED'
                      : workflow.scheduleEnabled && workflow.nextRunAt
                      ? ` · NEXT ${formatInZone(workflow.nextRunAt, workflow.timezone, 'ccc d LLL HH:mm')}`
                      : ' · MANUAL'}
                    {last?.startedAt
                      ? ` · LAST RUN ${formatInZone(last.startedAt, workflow.timezone, 'd LLL HH:mm')}`
                      : ' · NEVER RUN'}
                  </p>
                  </Link>
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
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
