import { Suspense } from 'react';
import Link from 'next/link';
import { Badge, Button, EmptyState, Field, Select, TextArea } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { createCampaignAction } from '@/app/actions/campaigns';
import { CampaignsPagePreview } from '@/components/page-previews';
import { ActionForm } from '@/components/action-form';
import { PendingButton } from '@/components/action-ui';
import type { ActionState } from '@/lib/actions/state';
import { CAMPAIGN_COLOR_LABELS, CAMPAIGN_COLORS, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUSES } from '@/lib/campaigns/validation';

export const metadata = { title: 'Campaigns' };

async function createCampaignFormAction(slug: string, _state: ActionState, formData: FormData) {
  'use server';
  return createCampaignAction(slug, formData);
}
export default function CampaignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  return (
    <>
      <div><p className="b88-eyebrow">Organization</p><h1 className="b88-page-title mt-3">Campaigns</h1></div>
      <Suspense fallback={<CampaignsPagePreview />}>
        <CampaignsData params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
async function CampaignsData({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const q = query.q?.trim() ?? '';
  const archivedOnly = query.view === 'archived';
  const ctx = await requireWorkspace(slug, 'campaign:view');
  const campaigns = await db.campaign.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      status: archivedOnly ? 'ARCHIVED' : { not: 'ARCHIVED' },
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    },
    include: { _count: { select: { posts: true } } },
    orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
  });
  return (
    <div className="mt-6 min-h-[420px]">
      <div className="flex flex-wrap items-end justify-end gap-4">
        {ctx.can('campaign:manage') && <Button href={`/w/${slug}/compose`}>Create a post</Button>}
      </div>

      {ctx.can('campaign:manage') && (
        <details id="create-campaign" className="mt-6 rounded-lg bg-[var(--block-cream)] p-5">
          <summary className="cursor-pointer font-[540]">Create campaign</summary>
          <ActionForm action={createCampaignFormAction.bind(null, slug)} className="mt-5 grid gap-4 lg:grid-cols-4">
            <Field name="name" label="Name" required containerClassName="lg:col-span-2" />
            <Select name="status" label="Status" defaultValue="PLANNED">
              {CAMPAIGN_STATUSES.map((status) => <option key={status} value={status}>{CAMPAIGN_STATUS_LABELS[status]}</option>)}
            </Select>
            <Select name="color" label="Color">
              {CAMPAIGN_COLORS.map((color) => <option key={color} value={color}>{CAMPAIGN_COLOR_LABELS[color]}</option>)}
            </Select>
            <TextArea name="description" label="Description" rows={2} containerClassName="lg:col-span-2" />
            <Field name="startDate" label="Start date" type="date" />
            <Field name="endDate" label="End date" type="date" />
            <div className="lg:col-span-4"><PendingButton type="submit" pendingLabel="Creating campaign">Create campaign</PendingButton></div>
          </ActionForm>
        </details>
      )}

      <form className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
        <Field name="q" label="Find a campaign" defaultValue={q} placeholder="Search by name" />
        <Select name="view" label="Show" defaultValue={archivedOnly ? 'archived' : 'current'}>
          <option value="current">Current</option>
          <option value="archived">Archived</option>
        </Select>
        <Button type="submit" variant="secondary" className="self-end">Apply</Button>
      </form>

      <section className="b88-card mt-6">
          {campaigns.length ? campaigns.map((campaign) => (
            <article key={campaign.id} className="border-t border-hairline-soft py-4 first:border-0">
              <div className="flex items-center gap-4">
                <span className="size-10 shrink-0 rounded-md" style={{ background: `var(--block-${campaign.color})` }}/>
                <div className="min-w-0 flex-1">
                  <Link className="font-[540] underline-offset-4 hover:underline" href={`/w/${slug}/campaigns/${campaign.id}`}>{campaign.name}</Link>
                  <p className="mt-1 truncate text-sm">{campaign.description ?? 'No description'} · {campaign._count.posts} post{campaign._count.posts === 1 ? '' : 's'}</p>
                </div>
                <Badge tone={campaign.status === 'ACTIVE' ? 'lime' : campaign.status === 'ARCHIVED' ? 'neutral' : 'outline'}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
                <Button href={`/w/${slug}/campaigns/${campaign.id}`} variant="tertiary">Open</Button>
              </div>
            </article>
          )) : (
            <EmptyState
              eyebrow={q ? 'No matches' : archivedOnly ? 'No archived campaigns' : 'No campaigns yet'}
              title={q ? 'Try another campaign name' : archivedOnly ? 'No archived campaigns' : 'Plan your first campaign'}
              action={!q && !archivedOnly && ctx.can('campaign:manage') ? <Button href="#create-campaign">Create campaign</Button> : undefined}
            />
          )}
      </section>
    </div>
  );
}
