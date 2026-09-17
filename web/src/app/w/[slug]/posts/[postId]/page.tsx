import Link from 'next/link';
import { Badge, Button, EmptyState, MediaFrame, StatCard, StatusMessage } from '@/bridge88/components';
import { humanizeMachineValue } from '@/bridge88/humanize';
import { ConfirmationButton, PendingButton } from '@/components/action-ui';
import { postCommandAction, setPostArchivedAction } from '@/app/actions/posts';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { formatMetric } from '@/lib/analytics/aggregate';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { formatInZone, timezoneLabel } from '@/lib/scheduling/time';
import { storage } from '@/lib/storage';
import { notFound } from 'next/navigation';
import type { PostStatus } from '@prisma/client';
import { legalPostActions, type PostLifecycleAction } from '@/lib/posts/lifecycle';
import { replyToApprovalCommentAction } from '@/app/actions/team';
import { APPROVAL_DECISION_LABELS, POST_PLATFORM_STATUS_LABELS, postStatusLabel } from '@/lib/posts/labels';
import { approvalOutcome, describeOrigin, postOriginInclude } from '@/lib/posts/origin';

/**
 * The list each status is reachable from, for the back link.
 *
 * Only scheduled and published posts sit on the calendar; everything else is
 * found through drafts or the approval queue, and that is where leaving the
 * post should return you.
 */
const BACK_TO: Partial<Record<PostStatus, { href: string; label: string }>> = {
  DRAFT: { href: '/drafts', label: 'drafts' },
  REJECTED: { href: '/drafts', label: 'drafts' },
  PENDING_APPROVAL: { href: '/team', label: 'approvals' },
  APPROVED: { href: '/drafts', label: 'drafts' },
  CANCELLED: { href: '/drafts', label: 'drafts' },
};

const statusTone = {
  DRAFT: 'outline',
  REJECTED: 'coral',
  PENDING_APPROVAL: 'cream',
  APPROVED: 'mint',
  SCHEDULED: 'lime',
  PUBLISHING: 'lilac',
  PUBLISHED: 'mint',
  FAILED: 'coral',
  CANCELLED: 'outline',
} as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug, postId } = await params;
  const ctx = await requireWorkspace(slug, 'post:view');
  const post = await db.post.findFirst({
    where: { id: postId, workspaceId: ctx.workspace.id },
    select: { title: true },
  });
  return { title: post?.title?.trim() || 'Post' };
}

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug, postId } = await params;
  const ctx = await requireWorkspace(slug, 'post:view');
  const post = await db.post.findFirst({
    where: { id: postId, workspaceId: ctx.workspace.id },
    include: {
      author: { select: { name: true, email: true } },
      campaign: { select: { name: true } },
      platforms: {
        include: {
          analytics: true,
          socialAccount: { select: { accountName: true, accountHandle: true } },
          media: {
            orderBy: { position: 'asc' },
            include: {
              mediaAsset: {
                select: { filename: true, type: true, storageKey: true, thumbnailKey: true },
              },
            },
          },
        },
      },
      approvalComments: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { name: true, email: true } } },
      },
      ...postOriginInclude,
    },
  });
  if (!post) notFound();
  const origin = describeOrigin(slug, post);

  const channels = await Promise.all(post.platforms.map(async (channel) => ({
    ...channel,
    media: await Promise.all(channel.media.map(async (item) => {
      const asset = item.mediaAsset;
      // A video element cannot decode the .webp still, so it gets the file
      // itself and wears the thumbnail as its poster. Stills stay on the
      // thumbnail, which is all this frame is ever large enough to show.
      const video = asset.type === 'VIDEO';
      return {
        ...item,
        url: await storage().signedUrl(video ? asset.storageKey : asset.thumbnailKey ?? asset.storageKey),
        posterUrl: asset.thumbnailKey ? await storage().signedUrl(asset.thumbnailKey) : undefined,
      };
    })),
  })));
  const title = post.title?.trim() || post.platforms[0]?.text.trim().slice(0, 70) || 'Untitled post';
  const backTo = BACK_TO[post.status] ?? { href: '/calendar', label: 'calendar' };

  return (
    <>
      {/*
        Back to where this post actually lives. A post awaiting review or still
        a draft has no scheduled time, so it is not on the calendar at all —
        sending a reviewer there stranded them somewhere the post they had just
        been reading did not appear.
      */}
      <Link href={`/w/${slug}${backTo.href}`} className="font-[480]">Back to {backTo.label}</Link>
      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="b88-eyebrow">Post detail</p>
          <h1 className="b88-page-title mt-3 break-words">{title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[post.status]}>{postStatusLabel(post.status, post.scheduledAt)}</Badge>
            {post.campaign && <Badge tone="outline">{post.campaign.name}</Badge>}
          </div>
        </div>
        <PostActions
          slug={slug}
          postId={post.id}
          status={post.status}
          timezone={ctx.workspace.timezone}
          canUpdate={ctx.can('post:update')}
          canDelete={ctx.can('post:delete')}
          canPublish={ctx.can('post:publish')}
          canSchedule={ctx.can('post:schedule')}
          archived={Boolean(post.archivedAt)}
        />
      </div>

      {post.status === 'PENDING_APPROVAL' && (
        <StatusMessage tone="neutral" className="mt-6">
          This post is waiting for review. {approvalOutcome(post.releaseOnApproval)}
          <Link href={`/w/${slug}/team`} className="ml-2 font-[480] underline underline-offset-4">Open approvals</Link>
        </StatusMessage>
      )}
      {/*
        An approved post is the quietest failure state in the app: it looks
        finished, and nothing is going to publish it. The engine scans for
        SCHEDULED, never APPROVED, so this has to be said out loud.
      */}
      {post.status === 'APPROVED' && (
        <StatusMessage tone="neutral" className="mt-6">
          This post is approved but not scheduled — nothing publishes an approved post on its own.
          Choose a time with Schedule, or send it now with Publish now.
        </StatusMessage>
      )}
      {post.status === 'CANCELLED' && (
        <StatusMessage tone="neutral" className="mt-6">
          This post is cancelled. Restore it to a draft to work on it again, or publish it now.
        </StatusMessage>
      )}
      {post.status === 'REJECTED' && (
        <StatusMessage tone="error" className="mt-6">
          This post was rejected. Review the approval conversation, edit the post, and submit it again.
        </StatusMessage>
      )}
      {post.status === 'FAILED' && (
        <StatusMessage tone="error" className="mt-6">
          Publishing failed. Fix the post and retry, or choose a new publishing time.
        </StatusMessage>
      )}

      <section className="b88-card mt-8">
        <p className="b88-caption">Post record</p>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <div><dt className="b88-label">Author</dt><dd className="mt-2">{post.author?.name ?? post.author?.email ?? 'Former member'}</dd></div>
          {/*
            The provenance row. A post that appeared overnight from a scheduled
            run used to be indistinguishable from one a person typed, which is
            what made an approval request impossible to judge.
          */}
          <div>
            <dt className="b88-label">Origin</dt>
            <dd className="mt-2">
              {origin ? (
                <>
                  <Link href={origin.runHref} className="underline underline-offset-4">{origin.workflowName}</Link>
                  <span className="b88-caption mt-1 block">
                    {origin.stepName} · {origin.triggerPhrase}
                  </span>
                </>
              ) : 'Composed by hand'}
            </dd>
          </div>
          <div><dt className="b88-label">Campaign</dt><dd className="mt-2">{post.campaign?.name ?? 'No campaign'}</dd></div>
          <div><dt className="b88-label">Created</dt><dd className="mt-2">{formatInZone(post.createdAt, ctx.workspace.timezone)}</dd></div>
          <div><dt className="b88-label">Updated</dt><dd className="mt-2">{formatInZone(post.updatedAt, ctx.workspace.timezone)}</dd></div>
          <div><dt className="b88-label">Scheduled</dt><dd className="mt-2">{post.scheduledAt ? formatInZone(post.scheduledAt, ctx.workspace.timezone) : 'Not scheduled'}</dd></div>
          <div><dt className="b88-label">Published</dt><dd className="mt-2">{post.publishedAt ? formatInZone(post.publishedAt, ctx.workspace.timezone) : 'Not published'}</dd></div>
          <div><dt className="b88-label">Timezone</dt><dd className="mt-2">{timezoneLabel(post.timezone)}</dd></div>
          {/* Named, not counted. "Channels: 2" never told anyone which two. */}
          <div>
            <dt className="b88-label">Channels</dt>
            <dd className="mt-2">
              {channels.map((channel) => (
                <span key={channel.id} className="block truncate">
                  {channel.socialAccount.accountName} · {PLATFORM_LABELS[channel.platform]}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </section>

      <div className="mt-6 space-y-6">
        {channels.map((channel) => (
          <section key={channel.id} className="b88-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="b88-heading">{channel.socialAccount.accountName}</h2>
                <p className="b88-caption mt-2">
                  {channel.socialAccount.accountHandle ?? PLATFORM_LABELS[channel.platform]} · {POST_PLATFORM_STATUS_LABELS[channel.status]}
                </p>
              </div>
              <Badge tone="outline">{PLATFORM_LABELS[channel.platform]}</Badge>
            </div>
            <p className="mt-6 whitespace-pre-wrap">{channel.text || 'No caption'}</p>
            {(channel.hashtags.length > 0 || channel.mentions.length > 0) && (
              <p className="mt-4 text-sm">
                {[...channel.mentions.map((value) => `@${value}`), ...channel.hashtags.map((value) => `#${value}`)].join(' ')}
              </p>
            )}
            {channel.link && <a href={channel.link} className="mt-3 block break-all underline underline-offset-4">{channel.link}</a>}
            {channel.firstComment && <div className="mt-5 rounded-md bg-surface-soft p-4"><p className="b88-label">First comment</p><p className="mt-2 whitespace-pre-wrap">{channel.firstComment}</p></div>}
            {channel.media.length > 0 && (
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {channel.media.map((item) => (
                  <div key={item.id}>
                    <MediaFrame
                      src={item.url}
                      poster={item.posterUrl}
                      type={item.mediaAsset.type === 'VIDEO' ? 'video' : 'image'}
                      ratio="1:1"
                      alt={item.altText ?? humanizeMachineValue(item.mediaAsset.filename)}
                    />
                    <p className="b88-caption mt-2 truncate">{humanizeMachineValue(item.mediaAsset.filename)}</p>
                  </div>
                ))}
              </div>
            )}
            {channel.errorMessage && <StatusMessage tone="error" className="mt-5">This channel could not publish the post. Review the channel connection and post requirements, then try again.</StatusMessage>}
          </section>
        ))}
      </div>

      <section className="b88-card mt-6">
        <p className="b88-caption">Publication history</p>
        <h2 className="b88-heading mt-2">Delivery by channel</h2>
        <div className="mt-5">
          {channels.map((channel) => (
            <div key={channel.id} className="flex flex-wrap items-center gap-3 border-t border-hairline-soft py-4 first:border-0">
              <span className="min-w-0 flex-1">{PLATFORM_LABELS[channel.platform]} · {channel.socialAccount.accountName}</span>
              <span className="b88-caption">{channel.attempts} {channel.attempts === 1 ? 'attempt' : 'attempts'}</span>
              <Badge tone={channel.status === 'FAILED' ? 'coral' : channel.status === 'PUBLISHED' ? 'mint' : 'outline'}>
                {POST_PLATFORM_STATUS_LABELS[channel.status]}
              </Badge>
            </div>
          ))}
        </div>
      </section>

      <section className="b88-card mt-6">
        <p className="b88-caption">Approval history</p>
        <h2 className="b88-heading mt-2">Review activity</h2>
        {post.approvalComments.length ? (
          <div className="mt-5">
            {post.approvalComments.map((comment) => (
              <article key={comment.id} className={`border-t border-hairline-soft py-4 first:border-0 ${comment.parentId ? 'ml-8 border-l border-l-hairline pl-4' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-[480]">{comment.author?.name ?? comment.author?.email ?? 'Former member'}</span>
                  <Badge tone="outline">{APPROVAL_DECISION_LABELS[comment.decision]}</Badge>
                  <span className="b88-caption">{formatInZone(comment.createdAt, ctx.workspace.timezone)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{comment.body}</p>
                {ctx.can('post:approve') && (
                  <form action={async (formData) => { 'use server'; await replyToApprovalCommentAction(slug, post.id, comment.id, formData); }} className="mt-3 flex gap-2">
                    <input name="body" className="b88-filter-control min-w-0 flex-1" aria-label={`Reply to ${comment.author?.name ?? 'comment'}`} placeholder="Write a reply" required />
                    <Button type="submit" variant="tertiary">Reply</Button>
                  </form>
                )}
              </article>
            ))}
          </div>
        ) : <p className="mt-5">No review activity yet.</p>}
      </section>

      <section className="mt-6">
        <p className="b88-caption">Analytics</p>
        <h2 className="b88-heading mt-2">Post performance</h2>
        <div className="mt-5 space-y-6">
          {channels.some((channel) => channel.analytics) ? channels.map((channel) => channel.analytics ? (
            <div key={channel.id} className="b88-card">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-[540]">{PLATFORM_LABELS[channel.platform]}</h3>
                <span className="b88-caption">Updated {formatInZone(channel.analytics.fetchedAt, ctx.workspace.timezone)}</span>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Impressions" value={formatMetric(channel.analytics.impressions)} />
                <StatCard label="Reach" value={formatMetric(channel.analytics.reach)} />
                <StatCard label="Likes" value={formatMetric(channel.analytics.likes)} />
                <StatCard label="Comments" value={formatMetric(channel.analytics.comments)} />
                <StatCard label="Shares" value={formatMetric(channel.analytics.shares)} />
                <StatCard label="Saves" value={formatMetric(channel.analytics.saves)} />
                <StatCard label="Clicks" value={formatMetric(channel.analytics.clicks)} />
                <StatCard label="Video views" value={formatMetric(channel.analytics.videoViews)} />
              </div>
            </div>
          ) : null) : (
            <EmptyState eyebrow="No metrics yet" title="Analytics are not available" />
          )}
        </div>
      </section>
    </>
  );
}

function PostActions({
  slug,
  postId,
  status,
  timezone,
  canUpdate,
  canDelete,
  canPublish,
  canSchedule,
  archived,
}: {
  slug: string;
  postId: string;
  status: PostStatus;
  timezone: string;
  canUpdate: boolean;
  canDelete: boolean;
  canPublish: boolean;
  canSchedule: boolean;
  archived: boolean;
}) {
  /*
    Which buttons appear comes from the lifecycle table, which is also what
    postCommandAction checks before doing anything. It used to come from four
    status lists written out by hand here, and they had drifted from that table
    in both directions: a post waiting for approval was offered no Edit button
    even though editing one is legal — so arriving here from the approval queue
    was a dead end with no way through to the draft — while a cancelled post
    was offered Edit, which the server refuses.
  */
  const actions = legalPostActions(status);
  const can = (action: PostLifecycleAction) => actions.includes(action);
  // FAILED allows retry rather than publish; every other publishable state is
  // the other way round.
  const publishCommand = can('retry') ? 'retry' : 'publish';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Archiving sits outside the lifecycle table: it files a post away
          without changing what state it is in. */}
      {canUpdate && (archived || ['DRAFT', 'REJECTED', 'PUBLISHED', 'FAILED', 'CANCELLED'].includes(status)) && (
        <form action={setPostArchivedAction.bind(null, slug, postId, !archived)}>
          <PendingButton type="submit" variant="tertiary" pendingLabel={archived ? 'Restoring' : 'Archiving'}>
            {archived ? 'Restore from archive' : 'Archive post'}
          </PendingButton>
        </form>
      )}
      {canUpdate && can('edit') && (
        <Button href={`/w/${slug}/compose/${postId}`}>
          {status === 'PENDING_APPROVAL' ? 'Open the draft' : 'Edit post'}
        </Button>
      )}
      {canSchedule && can('schedule') && (
        <Button href={`/w/${slug}/compose/${postId}`} variant="secondary">Schedule</Button>
      )}
      {canPublish && (can('publish') || can('retry')) && (
        <form action={async () => { 'use server'; await postCommandAction(slug, postId, publishCommand); }}>
          <PendingButton type="submit" variant="secondary" pendingLabel={publishCommand === 'retry' ? 'Retrying' : 'Publishing'}>
            {publishCommand === 'retry' ? 'Retry publish' : 'Publish now'}
          </PendingButton>
        </form>
      )}
      {canSchedule && can('reschedule') && (
        <form action={async (formData: FormData) => { 'use server'; await postCommandAction(slug, postId, 'reschedule', formData); }} className="flex flex-wrap items-center gap-2">
          <input type="datetime-local" name="scheduledAt" className="b88-filter-control h-10 w-auto" aria-label={`New publishing time (${timezoneLabel(timezone)})`} required />
          <PendingButton type="submit" variant="secondary" pendingLabel="Rescheduling">Reschedule</PendingButton>
        </form>
      )}
      {canUpdate && can('cancel') && (
        <form action={async () => { 'use server'; await postCommandAction(slug, postId, 'cancel'); }}>
          <PendingButton type="submit" variant="tertiary" pendingLabel="Cancelling">
            {status === 'SCHEDULED' ? 'Cancel schedule' : 'Cancel post'}
          </PendingButton>
        </form>
      )}
      {canUpdate && can('restore') && (
        <form action={async () => { 'use server'; await postCommandAction(slug, postId, 'restore'); }}>
          <PendingButton type="submit" pendingLabel="Restoring">Restore to draft</PendingButton>
        </form>
      )}
      {can('duplicate') && (
        <form action={async () => { 'use server'; await postCommandAction(slug, postId, 'duplicate'); }}>
          <PendingButton type="submit" variant="secondary" pendingLabel="Duplicating">Duplicate</PendingButton>
        </form>
      )}
      {canDelete && can('delete') && (
        <form action={async () => { 'use server'; await postCommandAction(slug, postId, 'delete'); }}>
          <ConfirmationButton type="submit" variant="tertiary" confirmMessage="Delete this post permanently?" pendingLabel="Deleting">Delete</ConfirmationButton>
        </form>
      )}
    </div>
  );
}
