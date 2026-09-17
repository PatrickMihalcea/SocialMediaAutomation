import { Badge } from '@/bridge88/components';
import type { PostStatus } from '@prisma/client';
import { ComposerForm } from '@/components/composer-form';
import { ConfirmationButton, PendingButton } from '@/components/action-ui';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { loadComposerContext } from '@/lib/posts/load';
import { parseComposerContext } from '@/lib/posts/lifecycle';
import { legalPostActions } from '@/lib/posts/lifecycle';
import { PLATFORM_LABELS } from '@/lib/social/labels';
import { postCommandAction, updatePostAction, type ComposerState } from '@/app/actions/posts';
import { cancelApprovalRequestAction } from '@/app/actions/team';
import { POST_STATUS_LABELS } from '@/lib/posts/labels';
import { timezoneLabel } from '@/lib/scheduling/time';
import { DateTime } from 'luxon';

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

export default async function EditComposePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; postId: string }>;
  searchParams: Promise<{ asset?: string }>;
}) {
  const { slug, postId } = await params;
  const query = await searchParams;
  const ctx = await requireWorkspace(slug, 'post:view');
  const data = await loadComposerContext(ctx.workspace.id, slug, postId, query.asset);
  if (!data.post) return null;
  const context = parseComposerContext(query, {
    assetIds: data.assets.map((asset) => asset.id),
    campaignIds: data.campaigns.map((campaign) => campaign.id),
  });

  async function action(state: ComposerState, formData: FormData): Promise<ComposerState> {
    'use server';
    return updatePostAction(slug, postId, state, formData);
  }
  const scheduledLabel = data.initial?.scheduledAt
    ? DateTime.fromISO(data.initial.scheduledAt, { zone: data.timezone }).toFormat('ccc d LLL yyyy, HH:mm')
    : 'Not scheduled';

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="b88-eyebrow">Composer</p>
          <h1 className="b88-page-title mt-3">Edit post</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[data.post.status]}>{POST_STATUS_LABELS[data.post.status]}</Badge>
            <span className="b88-caption">{scheduledLabel}</span>
          </div>
        </div>
        <PostCommands
          slug={slug}
          postId={postId}
          status={data.post.status}
          timezone={data.timezone}
          canDelete={ctx.can('post:delete')}
          canPublish={ctx.can('post:publish')}
          canSchedule={ctx.can('post:schedule')}
          channelLabels={(data.initial?.platforms ?? []).map((platform) => {
            const account = data.accounts.find((item) => item.id === platform.socialAccountId);
            return `${PLATFORM_LABELS[platform.platform]} (${account?.accountHandle ?? account?.accountName ?? 'connected account'})`;
          })}
        />
      </div>
      {data.accounts.length ? (
        <ComposerForm
          slug={slug}
          action={action}
          accounts={data.accounts}
          assets={data.assets}
      audioTracks={data.audioTracks}
          campaigns={data.campaigns}
          timezone={data.timezone}
          postId={postId}
          postStatus={data.post.status}
          initial={data.initial}
          attachAssetId={context.assetId}
          canSchedule={ctx.can('post:schedule')}
          canPublish={ctx.can('post:publish')}
          canSubmitForApproval={ctx.can('post:submit_for_approval')}
        />
      ) : (
        <section className="rounded-lg bg-[var(--block-cream)] p-8">
          <p className="b88-eyebrow">No channels</p>
          <h2 className="b88-heading mt-3">Reconnect an account to keep editing this post.</h2>
        </section>
      )}
    </>
  );
}

function PostCommands({
  slug,
  postId,
  status,
  timezone,
  canDelete,
  canPublish,
  canSchedule,
  channelLabels,
}: {
  slug: string;
  postId: string;
  status: PostStatus;
  timezone: string;
  canDelete: boolean;
  canPublish: boolean;
  canSchedule: boolean;
  channelLabels: string[];
}) {
  const actions = legalPostActions(status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.includes('duplicate') && <form action={async () => { 'use server'; await postCommandAction(slug, postId, 'duplicate'); }}>
        <PendingButton type="submit" variant="secondary" pendingLabel="Duplicating">Duplicate</PendingButton>
      </form>}
      {actions.includes('retry') && canPublish && (
        <form action={async () => { 'use server'; await postCommandAction(slug, postId, 'retry'); }}>
          <ConfirmationButton
            type="submit"
            variant="secondary"
            pendingLabel="Publishing"
            confirmMessage={`Retry publishing only to the unsuccessful channels: ${channelLabels.join(', ')}?`}
          >
            Retry publish
          </ConfirmationButton>
        </form>
      )}
      {actions.includes('withdrawApproval') && (
        <form action={async () => { 'use server'; await cancelApprovalRequestAction(slug, postId); }}>
          <ConfirmationButton
            type="submit"
            variant="secondary"
            pendingLabel="Withdrawing"
            confirmMessage="Withdraw this approval request and return the post to drafts?"
          >
            Withdraw approval request
          </ConfirmationButton>
        </form>
      )}
      {actions.includes('cancel') && (
        <form action={async () => { 'use server'; await postCommandAction(slug, postId, 'cancel'); }}>
          <ConfirmationButton
            type="submit"
            variant="tertiary"
            pendingLabel="Cancelling"
            confirmMessage="Cancel this post and remove it from its publishing time? You can restore it as a draft later."
          >
            Cancel schedule
          </ConfirmationButton>
        </form>
      )}
      {actions.includes('restore') && (
        <form action={async () => { 'use server'; await postCommandAction(slug, postId, 'restore'); }}>
          <PendingButton type="submit" variant="secondary" pendingLabel="Restoring">Restore draft</PendingButton>
        </form>
      )}
      {actions.includes('reschedule') && canSchedule && (
        <form action={async (formData: FormData) => { 'use server'; await postCommandAction(slug, postId, 'reschedule', formData); }} className="flex items-center gap-2">
          <input type="datetime-local" name="scheduledAt" className="b88-filter-control w-auto" aria-label={`Reschedule (${timezoneLabel(timezone)})`} />
          <PendingButton type="submit" variant="secondary" pendingLabel="Rescheduling">Reschedule</PendingButton>
        </form>
      )}
      {canDelete && actions.includes('delete') && (
        <form action={async () => { 'use server'; await postCommandAction(slug, postId, 'delete'); }}>
          <ConfirmationButton type="submit" variant="tertiary" confirmMessage="Delete this post permanently?" pendingLabel="Deleting">
            Delete
          </ConfirmationButton>
        </form>
      )}
    </div>
  );
}
