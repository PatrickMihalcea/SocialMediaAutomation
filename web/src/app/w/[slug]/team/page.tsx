import { Suspense } from 'react';
import Link from 'next/link';
import { Avatar, Badge, Button, EmptyState, Field, MediaFrame, Select, StatusMessage } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import {
  approvalAction, removeMemberAction, resendInviteAction,
  revokeInviteAction, updateMemberRoleAction,
} from '@/app/actions/team';
import { ActionForm } from '@/components/action-form';
import { ConfirmationButton, PendingButton } from '@/components/action-ui';
import type { ActionState } from '@/lib/actions/state';
import { TeamPagePreview } from '@/components/page-previews';
import { InviteForm } from './invite-form';
import { WORKSPACE_ROLE_LABELS } from '@/lib/workspaces/labels';
import { approvalOutcome, approvalOutcomeShort, describeOrigin, postOriginInclude } from '@/lib/posts/origin';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { formatInZone } from '@/lib/scheduling/time';
import { storage } from '@/lib/storage';
import { profileImageSrc } from '@/lib/users/profile-image-src';

export const metadata = { title: 'Team' };

async function resendInviteFormAction(slug: string, inviteId: string, _state: ActionState, _formData: FormData) {
  'use server';
  return resendInviteAction(slug, inviteId);
}
export default function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ownershipTransferred?: string; outcome?: string; post?: string }>;
}) {
  return (
    <>
      <p className="b88-eyebrow">Collaboration</p><h1 className="b88-page-title mt-3">Team and approvals</h1>
      <Suspense fallback={<TeamPagePreview />}>
        <TeamData params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
async function TeamData({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ownershipTransferred?: string; outcome?: string; post?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await requireWorkspace(slug, 'member:view');
  const [members, invites, reviews] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId: ctx.workspace.id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.workspaceInvite.findMany({
      where: { workspaceId: ctx.workspace.id, acceptedAt: null, expiresAt: { gt: new Date() } },
    }),
    db.post.findMany({
      where: { workspaceId: ctx.workspace.id, status: 'PENDING_APPROVAL' },
      include: {
        author: true,
        // Every channel, not the first: "which account is this going to" is the
        // question a reviewer most needs answered, and take: 1 answered it
        // wrongly whenever a post targeted more than one.
        platforms: {
          select: {
            id: true,
            text: true,
            platform: true,
            socialAccount: { select: { accountName: true, accountHandle: true } },
            media: {
              orderBy: { position: 'asc' },
              take: 1,
              select: { mediaAsset: { select: { type: true, storageKey: true, thumbnailKey: true, filename: true } } },
            },
          },
        },
        ...postOriginInclude,
      },
      orderBy: { updatedAt: 'asc' },
    }),
  ]);
  // Resolved up front: an avatar is a freshly signed URL now, not a stored one,
  // and JSX cannot await inside the map below.
  const memberAvatars = new Map(await Promise.all(members.map(
    async (member) => [member.id, await profileImageSrc(member.user.image)] as const,
  )));
  const reviewPreviews = new Map(await Promise.all(reviews.map(async (post) => {
    const asset = post.platforms[0]?.media[0]?.mediaAsset;
    if (!asset) return [post.id, null] as const;
    const [src, poster] = await Promise.all([
      storage().signedUrl(asset.storageKey),
      asset.thumbnailKey ? storage().signedUrl(asset.thumbnailKey) : Promise.resolve(null),
    ]);
    return [post.id, { src, poster }] as const;
  })));
  return (
    <div className="mt-8 min-h-[620px]">
      {query.ownershipTransferred === '1' && (
        <StatusMessage tone="success" className="mt-6">
          Ownership transferred. Your role is now Admin.
        </StatusMessage>
      )}
      {/* The review row vanishes on a decision, which on its own is
          indistinguishable from nothing having happened. This says what was
          done and where to watch it. */}
      {query.outcome && (
        <StatusMessage tone={query.outcome === 'release-failed' ? 'error' : 'success'} className="mt-6">
          {{
            publishing: 'Approved and publishing now. It goes out within a minute or so — follow it on the post.',
            queued: 'Approved and added to the queue. It publishes at the next posting time.',
            approved: 'Approved. It has no release set, so schedule it when you are ready.',
            reviewed: 'Your review was recorded and the author has been notified.',
            'release-failed': 'Approved, but it could not be released. Open the post to see why and try again.',
          }[query.outcome] ?? 'Your review was recorded.'}
          {query.post && (
            <>
              {' '}
              <Link href={`/w/${slug}/posts/${query.post}`} className="underline underline-offset-4">
                Open the post
              </Link>
            </>
          )}
        </StatusMessage>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,.8fr)]">
        <section className="b88-card">
          <p className="b88-caption">Members</p><h2 className="b88-heading mt-2">Workspace access</h2>
          <div className="mt-5">
            {members.map((member) => (
              <div key={member.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-hairline-soft py-4 first:border-0">
                <Avatar name={member.user.name ?? member.user.email} src={memberAvatars.get(member.id)}/>
                <div className="min-w-0 flex-1"><p className="truncate font-[480]">{member.user.name ?? member.user.email}</p><p className="text-sm">{member.user.email}</p></div>
                {member.role === 'OWNER' || !ctx.can('member:update_role') ? (
                  <Badge tone={member.role === 'OWNER' ? 'ink' : 'outline'}>{WORKSPACE_ROLE_LABELS[member.role]}</Badge>
                ) : (
                  <div className="col-span-3 flex flex-wrap items-end gap-2 sm:col-span-1 sm:col-start-3">
                    <form action={updateMemberRoleAction.bind(null, slug, member.id)} className="flex min-w-0 flex-1 flex-wrap items-end gap-2 sm:flex-nowrap">
                      <Select
                        name="role"
                        label={`Role for ${member.user.name ?? member.user.email}`}
                        className="min-h-10 min-w-32 py-2"
                        containerClassName="min-w-0 flex-1"
                        defaultValue={member.role}
                      >
                        <option value="EDITOR">Editor</option><option value="VIEWER">Viewer</option><option value="ADMIN">Admin</option>
                      </Select>
                      <Button type="submit" variant="secondary">Save</Button>
                    </form>
                    {ctx.can('member:remove') && (
                      <form action={removeMemberAction.bind(null, slug, member.id)}>
                        <ConfirmationButton confirmMessage={`Remove ${member.user.name ?? member.user.email} from this workspace?`} variant="tertiary" pendingLabel="Removing">Remove</ConfirmationButton>
                      </form>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {!!invites.length && <div className="mt-5 rounded-md bg-surface-soft p-4"><p className="b88-caption">Pending invites</p>{invites.map((invite) => (
            <div key={invite.id} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="mr-auto">{invite.email} · {WORKSPACE_ROLE_LABELS[invite.role]}</span>
              {ctx.can('member:invite') && <><ActionForm action={resendInviteFormAction.bind(null, slug, invite.id)}><PendingButton type="submit" variant="secondary" pendingLabel="Resending">Resend</PendingButton></ActionForm><form action={revokeInviteAction.bind(null, slug, invite.id)}><ConfirmationButton confirmMessage={`Revoke the invitation for ${invite.email}?`} variant="tertiary" pendingLabel="Revoking">Revoke</ConfirmationButton></form></>}
            </div>
          ))}</div>}
        </section>
        {ctx.can('member:invite') && (
          <InviteForm slug={slug} />
        )}
      </div>

      <section className="b88-card mt-6">
        <p className="b88-caption">Approval queue</p><h2 className="b88-heading mt-2">Waiting for review</h2>
        {reviews.length ? <div className="mt-5 space-y-4">{reviews.map((post) => {
          const origin = describeOrigin(slug, post);
          return (
          <article key={post.id} className="rounded-md bg-surface-soft p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Button href={`/w/${slug}/posts/${post.id}`} variant="tertiary" className="-ml-4 font-[540]">{post.title ?? 'Untitled post'}</Button>
                <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm">{post.platforms[0]?.text}</p>
                {/*
                  Two different places to go, and conflating them was the
                  problem: the title opens the read-only record for judging the
                  post, while this opens the draft itself for changing it.
                  Only the record was reachable before, so "let me just fix the
                  caption" had nowhere to start.
                */}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <Link href={`/w/${slug}/posts/${post.id}`} className="b88-body-sm underline underline-offset-4">
                    Full post record
                  </Link>
                  {ctx.can('post:update') && (
                    <Link href={`/w/${slug}/compose/${post.id}`} className="b88-body-sm underline underline-offset-4">
                      Open the draft
                    </Link>
                  )}
                </div>
              </div>
              <Badge tone="cream">In review</Badge>
            </div>

            {post.platforms[0]?.media[0]?.mediaAsset && (
              <div className="mt-4 max-w-sm">
                <MediaFrame
                  src={reviewPreviews.get(post.id)?.src}
                  type={post.platforms[0].media[0].mediaAsset.type === 'VIDEO' ? 'video' : 'image'}
                  poster={reviewPreviews.get(post.id)?.poster ?? undefined}
                  ratio="16:9"
                  alt={post.platforms[0].media[0].mediaAsset.filename}
                  label="Post preview"
                />
              </div>
            )}

            {/*
              The four questions a reviewer has to answer before they can
              responsibly click Approve: where did this come from, when, where
              is it going, and what does approving do. The card previously
              answered none of them.
            */}
            <dl className="mt-4 grid gap-4 border-t border-hairline-soft pt-4 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt className="b88-label">Posting to</dt>
                <dd className="mt-1 text-sm">
                  {post.platforms.map((channel) => (
                    <span key={channel.id} className="block truncate">
                      {channel.socialAccount.accountName} · {PLATFORM_LABELS[channel.platform]}
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="b88-label">Created by</dt>
                <dd className="mt-1 text-sm">
                  {origin ? (
                    <Link href={origin.runHref} className="underline underline-offset-4">
                      {origin.workflowName} · {origin.stepName}
                    </Link>
                  ) : (
                    post.author?.name ?? post.author?.email ?? 'Former member'
                  )}
                </dd>
              </div>
              <div>
                <dt className="b88-label">Created</dt>
                <dd className="mt-1 text-sm">{formatInZone(post.createdAt, ctx.workspace.timezone)}</dd>
              </div>
              <div>
                <dt className="b88-label">On approval</dt>
                <dd className="mt-1 text-sm">{approvalOutcomeShort(post.releaseOnApproval)}</dd>
              </div>
            </dl>

            {ctx.can('post:approve') && <form className="mt-4">
              <Field name="body" label="Review note" placeholder="Optional context for the author" containerClassName="max-w-md" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button formAction={approvalAction.bind(null, slug, post.id, 'APPROVED')} name="releaseMode" value="now" type="submit">Approve & publish now</Button>
                <Button formAction={approvalAction.bind(null, slug, post.id, 'APPROVED')} name="releaseMode" value="queue" type="submit" variant="secondary">Approve & schedule</Button>
                <Button formAction={approvalAction.bind(null, slug, post.id, 'CHANGES_REQUESTED')} type="submit" variant="secondary">Request changes</Button>
                <Button formAction={approvalAction.bind(null, slug, post.id, 'REJECTED')} type="submit" variant="tertiary">Reject</Button>
              </div>
              <p className="b88-body-sm mt-3">{approvalOutcome(post.releaseOnApproval)}</p>
            </form>}
          </article>
          );
        })}</div> : (
          <div className="mt-5">
            <EmptyState
              eyebrow="Queue clear"
              title="No posts are waiting for approval"
              action={<Button href={`/w/${slug}/drafts`}>Open drafts</Button>}
            />
          </div>
        )}
      </section>
    </div>
  );
}
