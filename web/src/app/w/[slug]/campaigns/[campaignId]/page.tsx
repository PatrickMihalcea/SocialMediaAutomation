import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Select,
  TextArea,
} from '@/bridge88/components';
import { ActionForm } from '@/components/action-form';
import { ConfirmationButton, PendingButton } from '@/components/action-ui';
import {
  assignCampaignPostsAction,
  deleteCampaignAction,
  duplicateCampaignAction,
  moveCampaignPostsAction,
  removeCampaignPostsAction,
  setCampaignStatusAction,
  updateCampaignAction,
} from '@/app/actions/campaigns';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import type { ActionState } from '@/lib/actions/state';
import { CAMPAIGN_COLORS, CAMPAIGN_STATUSES } from '@/lib/campaigns/validation';

function label(value: string) {
  if (value === 'PLANNED') return 'Draft';
  const text = value.toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dateValue(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? '';
}

function postDescription(post: { status: string; scheduledAt: Date | null; campaign?: { name: string } | null }) {
  const timing = post.scheduledAt
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(post.scheduledAt)
    : 'Not scheduled';
  return `${label(post.status)} · ${timing}${post.campaign ? ` · currently in ${post.campaign.name}` : ' · uncategorized'}`;
}

async function updateAction(slug: string, campaignId: string, _state: ActionState, formData: FormData) {
  'use server';
  return updateCampaignAction(slug, campaignId, formData);
}

async function statusAction(slug: string, campaignId: string, status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED', _state: ActionState) {
  'use server';
  return setCampaignStatusAction(slug, campaignId, status);
}

async function assignAction(slug: string, campaignId: string, _state: ActionState, formData: FormData) {
  'use server';
  return assignCampaignPostsAction(slug, campaignId, formData);
}

async function managePostsAction(slug: string, campaignId: string, _state: ActionState, formData: FormData) {
  'use server';
  if (formData.get('intent') === 'move') return moveCampaignPostsAction(slug, campaignId, formData);
  return removeCampaignPostsAction(slug, campaignId, formData);
}

async function duplicateAction(slug: string, campaignId: string, _state: ActionState, formData: FormData) {
  'use server';
  return duplicateCampaignAction(slug, campaignId, formData);
}

async function deleteAction(slug: string, campaignId: string, _state: ActionState, formData: FormData) {
  'use server';
  return deleteCampaignAction(slug, campaignId, formData);
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ slug: string; campaignId: string }>;
}) {
  const { slug, campaignId } = await params;
  const ctx = await requireWorkspace(slug, 'campaign:view');
  const [campaign, otherCampaigns, assignablePosts] = await Promise.all([
    db.campaign.findFirst({
      where: { id: campaignId, workspaceId: ctx.workspace.id },
      include: {
        posts: { orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }] },
      },
    }),
    db.campaign.findMany({
      where: { workspaceId: ctx.workspace.id, id: { not: campaignId } },
      select: { id: true, name: true, status: true },
      orderBy: { name: 'asc' },
    }),
    db.post.findMany({
      where: { workspaceId: ctx.workspace.id, campaignId: { not: campaignId } },
      select: { id: true, title: true, status: true, scheduledAt: true, campaign: { select: { name: true } } },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    }),
  ]);
  if (!campaign) notFound();

  const canManage = ctx.can('campaign:manage');
  return (
    <>
      <Link href={`/w/${slug}/campaigns`} className="text-sm underline underline-offset-4">← All campaigns</Link>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="mt-1 size-12 shrink-0 rounded-md" style={{ background: `var(--block-${campaign.color})` }} />
          <div>
            <p className="b88-eyebrow">Campaign</p>
            <h1 className="b88-page-title mt-2">{campaign.name}</h1>
            <p className="mt-2 max-w-2xl">{campaign.description ?? 'No description yet.'}</p>
          </div>
        </div>
        <Badge tone={campaign.status === 'ACTIVE' ? 'lime' : campaign.status === 'ARCHIVED' ? 'neutral' : 'outline'}>{label(campaign.status)}</Badge>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button href={`/w/${slug}/compose?campaign=${campaign.id}`}>Create post in campaign</Button>
        <Button href={`/w/${slug}/calendar?campaign=${campaign.id}`} variant="secondary">View filtered calendar</Button>
        <Button href={`/w/${slug}/analytics?campaign=${campaign.id}`} variant="tertiary">Campaign analytics</Button>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
        <section className="b88-card">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="b88-caption">Campaign posts</p><h2 className="b88-heading mt-2">{campaign.posts.length} post{campaign.posts.length === 1 ? '' : 's'}</h2></div>
          </div>
          {campaign.posts.length ? (
            canManage ? (
              <ActionForm action={managePostsAction.bind(null, slug, campaignId)} className="mt-5">
                <div className="space-y-3">
                  {campaign.posts.map((post) => (
                    <div key={post.id} className="rounded-md border border-hairline-soft p-3">
                      <Checkbox name="postIds" value={post.id} label={post.title || 'Untitled post'} description={postDescription(post)} />
                      <Link href={`/w/${slug}/posts/${post.id}`} className="ml-7 mt-2 inline-block text-sm underline underline-offset-4">Open post</Link>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap items-end gap-2">
                  <PendingButton type="submit" name="intent" value="remove" variant="secondary" pendingLabel="Removing posts">Remove selected</PendingButton>
                  {otherCampaigns.length > 0 && (
                    <>
                      <Select name="destinationId" label="Move selected to" containerClassName="min-w-56">
                        <option value="">Choose campaign</option>
                        {otherCampaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </Select>
                      <PendingButton type="submit" name="intent" value="move" pendingLabel="Moving posts">Move selected</PendingButton>
                    </>
                  )}
                </div>
              </ActionForm>
            ) : (
              <div className="mt-5 space-y-3">
                {campaign.posts.map((post) => <Link key={post.id} href={`/w/${slug}/posts/${post.id}`} className="block rounded-md border border-hairline-soft p-3 hover:bg-surface-soft">{post.title || 'Untitled post'}<span className="mt-1 block text-sm">{postDescription(post)}</span></Link>)}
              </div>
            )
          ) : (
            <div className="mt-5"><EmptyState eyebrow="No posts assigned" title="Build this campaign’s content plan" action={canManage ? <Button href={`/w/${slug}/compose?campaign=${campaign.id}`}>Create a post</Button> : undefined}>Create a new post in this campaign, or assign existing posts below.</EmptyState></div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="b88-card">
            <p className="b88-caption">Schedule</p>
            <p className="mt-3 text-sm">{campaign.startDate ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(campaign.startDate) : 'No start date'} — {campaign.endDate ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(campaign.endDate) : 'No end date'}</p>
          </section>

          {canManage && (
            <details className="b88-card">
              <summary className="cursor-pointer font-[540]">Edit campaign</summary>
              <ActionForm action={updateAction.bind(null, slug, campaignId)} className="mt-5 space-y-4">
                <Field name="name" label="Name" defaultValue={campaign.name} required />
                <TextArea name="description" label="Description" defaultValue={campaign.description ?? ''} rows={3} />
                <div className="grid grid-cols-2 gap-3"><Field name="startDate" label="Start date" type="date" defaultValue={dateValue(campaign.startDate)} /><Field name="endDate" label="End date" type="date" defaultValue={dateValue(campaign.endDate)} /></div>
                <Select name="status" label="Status" defaultValue={campaign.status}>{CAMPAIGN_STATUSES.map((status) => <option key={status} value={status}>{label(status)}</option>)}</Select>
                <Select name="color" label="Color" defaultValue={campaign.color}>{CAMPAIGN_COLORS.map((color) => <option key={color} value={color}>{label(color)}</option>)}</Select>
                <PendingButton type="submit" pendingLabel="Saving campaign">Save changes</PendingButton>
              </ActionForm>
            </details>
          )}

          {canManage && (
            <ActionForm action={statusAction.bind(null, slug, campaignId, campaign.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED')} className="b88-card">
              <p className="font-[540]">{campaign.status === 'ARCHIVED' ? 'Restore campaign' : 'Archive campaign'}</p>
              <p className="mt-2 text-sm">{campaign.status === 'ARCHIVED' ? 'Return this campaign to active work. Its posts and history are unchanged.' : 'Keep the campaign and its posts available historically.'}</p>
              <PendingButton type="submit" variant="secondary" className="mt-4" pendingLabel="Updating campaign">{campaign.status === 'ARCHIVED' ? 'Restore as active' : 'Archive campaign'}</PendingButton>
            </ActionForm>
          )}
        </aside>
      </div>

      {canManage && (
        <section className="b88-card mt-6">
          <details>
            <summary className="cursor-pointer font-[540]">Assign existing posts</summary>
            {assignablePosts.length ? (
              <ActionForm action={assignAction.bind(null, slug, campaignId)} className="mt-5">
                <p className="mb-4 text-sm">Posts already in another campaign will be moved here and removed from their current campaign.</p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {assignablePosts.map((post) => <div key={post.id} className="rounded-md border border-hairline-soft p-3"><Checkbox name="postIds" value={post.id} label={post.title || 'Untitled post'} description={postDescription(post)} /></div>)}
                </div>
                <PendingButton type="submit" className="mt-5" pendingLabel="Assigning posts">Assign selected posts</PendingButton>
              </ActionForm>
            ) : <p className="mt-4 text-sm">Every available post is already in this campaign. Create a post to add another.</p>}
          </details>
        </section>
      )}

      {canManage && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <details className="b88-card">
            <summary className="cursor-pointer font-[540]">Duplicate campaign</summary>
            <ActionForm action={duplicateAction.bind(null, slug, campaignId)} className="mt-5 space-y-4">
              <p className="text-sm">The copy starts as a draft and remains independent from this campaign.</p>
              <Checkbox name="includePosts" label="Copy posts" description="Creates independent copies; originals stay here." />
              <Checkbox name="includeSchedule" label="Copy schedule" description="Keeps campaign dates and copied post publish times." />
              <PendingButton type="submit" variant="secondary" pendingLabel="Duplicating campaign">Duplicate campaign</PendingButton>
            </ActionForm>
          </details>

          <details className="b88-card border-[var(--block-coral)]">
            <summary className="cursor-pointer font-[540]">Delete campaign</summary>
            <ActionForm action={deleteAction.bind(null, slug, campaignId)} className="mt-5 space-y-4">
              <p className="text-sm">Deleting never deletes posts. Choose where all {campaign.posts.length} post{campaign.posts.length === 1 ? '' : 's'} should go.</p>
              <Select name="deleteMode" label="What happens to posts?" required>
                <option value="">Choose an option</option>
                <option value="keep">Keep posts without a campaign</option>
                {otherCampaigns.length > 0 && <option value="move">Move posts to another campaign</option>}
              </Select>
              {otherCampaigns.length > 0 && <Select name="destinationId" label="Destination campaign"><option value="">Choose campaign</option>{otherCampaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>}
              <ConfirmationButton type="submit" variant="tertiary" confirmMessage={`Delete ${campaign.name}? Its posts will not be deleted.`} pendingLabel="Deleting campaign">Delete campaign</ConfirmationButton>
              <p className="text-sm">Cancel by closing this section or leaving the page.</p>
            </ActionForm>
          </details>
        </div>
      )}
    </>
  );
}
