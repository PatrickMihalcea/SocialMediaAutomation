'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { issueSecret } from '@/lib/crypto/tokens';
import { hashSecret } from '@/lib/crypto/tokens';
import { assertWithinLimit } from '@/lib/billing/limits';
import { notifyRoles, notifyWorkspace } from '@/lib/notifications/service';
import { sendInviteEmail } from '@/lib/notifications/email';
import { publicEnv } from '@/lib/env';
import { requireUser } from '@/lib/auth/guard';
import { redirect } from 'next/navigation';
import { actionError, actionSuccess, type ActionState } from '@/lib/actions/state';
import { conflict, invalid } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { APPROVAL_DECISION_LABELS } from '@/lib/posts/labels';
import { isReleaseMode, releasePost } from '@/lib/posts/release';

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
});

export async function inviteMemberAction(slug: string, formData: FormData): Promise<ActionState> {
  const parsed = inviteMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return actionError(parsed.error, 'Enter a valid email and role.');
  try {
    const ctx = await requireWorkspace(slug, 'member:invite');
    const existingMember = await db.workspaceMember.findFirst({
      where: {
        workspaceId: ctx.workspace.id,
        user: { email: parsed.data.email.toLowerCase() },
      },
      select: { id: true },
    });
    if (existingMember) throw conflict('That person is already a workspace member.');
    const count = await db.workspaceMember.count({ where: { workspaceId: ctx.workspace.id } });
    await assertWithinLimit(ctx.workspace.id, 'teamMembers', count);
    const { secret, hash } = issueSecret();
    const invite = await db.workspaceInvite.upsert({
      where: { workspaceId_email: { workspaceId: ctx.workspace.id, email: parsed.data.email.toLowerCase() } },
      create: {
        workspaceId: ctx.workspace.id,
        email: parsed.data.email.toLowerCase(),
        role: parsed.data.role,
        tokenHash: hash,
        invitedById: ctx.user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      update: {
        role: parsed.data.role,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        acceptedAt: null,
      },
    });
    const inviteUrl = `${publicEnv.appUrl}/invite?token=${encodeURIComponent(secret)}`;
    await sendInviteEmail(invite.email, ctx.workspace.name, inviteUrl);
    revalidatePath(`/w/${slug}/team`);
    return actionSuccess(`Invite created. Share this link: ${inviteUrl}`);
  } catch (error) {
    return actionError(error, 'The invite could not be created.');
  }
}

export async function acceptInviteAction(token: string) {
  const user = await requireUser();
  const invite = await db.workspaceInvite.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: { workspace: true },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) redirect('/invite?error=expired');
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) redirect('/invite?error=email');
  await db.$transaction([
    db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
      create: { workspaceId: invite.workspaceId, userId: user.id, role: invite.role },
      update: {},
    }),
    db.workspaceInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);
  await notifyWorkspace(invite.workspaceId, {
    type: 'MEMBER_JOINED',
    title: `${user.name ?? user.email} joined the workspace`,
    href: `/w/${invite.workspace.slug}/team`,
  });
  redirect(`/w/${invite.workspace.slug}`);
}

export async function revokeInviteAction(slug: string, inviteId: string) {
  const ctx = await requireWorkspace(slug, 'member:invite');
  await db.workspaceInvite.deleteMany({ where: { id: inviteId, workspaceId: ctx.workspace.id } });
  revalidatePath(`/w/${slug}/team`);
}

export async function resendInviteAction(slug: string, inviteId: string): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'member:invite');
    const { secret, hash } = issueSecret();
    const invite = await db.workspaceInvite.update({
      where: { id: inviteId, workspaceId: ctx.workspace.id },
      data: { tokenHash: hash, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
    const inviteUrl = `${publicEnv.appUrl}/invite?token=${encodeURIComponent(secret)}`;
    await sendInviteEmail(invite.email, ctx.workspace.name, inviteUrl);
    revalidatePath(`/w/${slug}/team`);
    return actionSuccess(`Invite resent. Share this link: ${inviteUrl}`);
  } catch (error) {
    return actionError(error, 'The invite could not be resent.');
  }
}

export async function updateMemberRoleAction(slug: string, memberId: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'member:update_role');
  const role = z.enum(['ADMIN', 'EDITOR', 'VIEWER']).parse(formData.get('role'));
  await db.workspaceMember.updateMany({
    where: { id: memberId, workspaceId: ctx.workspace.id, role: { not: 'OWNER' } },
    data: { role },
  });
  revalidatePath(`/w/${slug}/team`);
}

export async function removeMemberAction(slug: string, memberId: string) {
  const ctx = await requireWorkspace(slug, 'member:remove');
  await db.workspaceMember.deleteMany({
    where: { id: memberId, workspaceId: ctx.workspace.id, role: { not: 'OWNER' } },
  });
  revalidatePath(`/w/${slug}/team`);
}

export async function approvalAction(
  slug: string,
  postId: string,
  decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
  formData: FormData,
) {
  const ctx = await requireWorkspace(slug, 'post:approve');
  const post = await db.post.findFirst({ where: { id: postId, workspaceId: ctx.workspace.id } });
  if (!post) throw invalid('That post is no longer available in this workspace.');
  const requestedRelease = String(formData.get('releaseMode') || '');
  if (requestedRelease && !isReleaseMode(requestedRelease)) {
    throw invalid('Choose whether approval should publish now or add the post to the queue.');
  }
  const providedComment = String(formData.get('body') || '').trim();
  const body = providedComment || APPROVAL_DECISION_LABELS[decision];
  const [comment] = await db.$transaction([
    db.approvalComment.create({
      data: { postId, workspaceId: ctx.workspace.id, authorId: ctx.user.id, decision, body },
    }),
    db.post.update({
      where: { id: postId },
      data: { status: decision === 'APPROVED' ? 'APPROVED' : decision === 'REJECTED' ? 'REJECTED' : 'DRAFT' },
    }),
  ]);
  const action = {
    APPROVED: 'approval.approved',
    REJECTED: 'approval.rejected',
    CHANGES_REQUESTED: 'approval.changes_requested',
  }[decision];
  await audit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action,
    entityType: 'approval',
    entityId: postId,
    metadata: { decision, ...(providedComment ? { comment: providedComment } : {}) },
  });
  if (providedComment) {
    await audit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: 'approval.commented',
      entityType: 'approval_comment',
      entityId: comment.id,
      metadata: { postId, comment: providedComment },
    });
  }

  // Approving used to be where an automated post went to die: it became
  // APPROVED, and nothing in the publishing engine looks at APPROVED — it scans
  // for SCHEDULED. A post created by a workflow carries the release its step was
  // configured with, and approval is what finally performs it.
  //
  // Deliberately after the approval commits rather than inside its transaction.
  // The decision is the reviewer's and must stick; a queue with no posting times
  // left, or a paused queue, is a separate problem that they can fix and retry
  // from the post itself, not a reason to lose their approval.
  let released: Date | null = null;
  let releaseError: string | null = null;
  const releaseMode = isReleaseMode(requestedRelease)
    ? requestedRelease
    : isReleaseMode(post.releaseOnApproval)
      ? post.releaseOnApproval
      : null;
  if (decision === 'APPROVED' && releaseMode) {
    try {
      released = await releasePost(ctx.workspace.id, postId, releaseMode);
      await audit({
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        action: 'approval.released',
        entityType: 'post',
        entityId: postId,
        metadata: { mode: releaseMode, scheduledAt: released.toISOString() },
      });
    } catch (error) {
      releaseError = error instanceof Error ? error.message : 'It could not be scheduled.';
    }
  }

  await notifyWorkspace(ctx.workspace.id, {
    type: 'APPROVAL_COMPLETED',
    title: {
      APPROVED: 'A post was approved',
      REJECTED: 'A post was rejected',
      CHANGES_REQUESTED: 'Changes were requested',
    }[decision],
    body: releaseError
      ? `${body} It was approved but not released: ${releaseError}`
      : released
        // "Scheduled" for a publish-now is how someone concludes their post
        // did not go out.
        ? `${body} ${releaseMode === 'now' ? 'It is publishing now.' : 'It is now scheduled to publish.'}`
        : body,
    href: `/w/${slug}/posts/${postId}`,
  });
  revalidatePath(`/w/${slug}/team`);
  revalidatePath(`/w/${slug}/queue`);
  revalidatePath(`/w/${slug}/calendar`);
  revalidatePath(`/w/${slug}/posts/${postId}`);
  revalidatePath(`/w/${slug}/history`);

  // Back to the same page, carrying what happened. The reviewer pressed a
  // button and the row simply vanished: no confirmation, nothing saying the
  // post was on its way, and nowhere pointing at where to watch it.
  const outcome = releaseError
    ? 'release-failed'
    : decision !== 'APPROVED'
      ? 'reviewed'
      : releaseMode === 'now'
        ? 'publishing'
        : releaseMode === 'queue'
          ? 'queued'
          : 'approved';
  redirect(`/w/${slug}/team?outcome=${outcome}&post=${postId}`);
}

export async function replyToApprovalCommentAction(
  slug: string,
  postId: string,
  parentId: string,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'post:approve');
    const body = z.string().trim().min(1, 'Write a reply.').max(2_000).parse(formData.get('body'));
    const parent = await db.approvalComment.findFirst({
      where: { id: parentId, postId, workspaceId: ctx.workspace.id },
      select: { id: true, postId: true, workspaceId: true },
    });
    if (!parent) throw invalid('That comment is no longer available on this post.');
    await db.approvalComment.create({
      data: {
        postId: parent.postId,
        workspaceId: parent.workspaceId,
        parentId: parent.id,
        authorId: ctx.user.id,
        decision: 'COMMENT',
        body,
      },
    });
    revalidatePath(`/w/${slug}/posts/${postId}`);
    return actionSuccess('Reply added.');
  } catch (error) {
    return actionError(error, 'The reply could not be added.');
  }
}

export async function cancelApprovalRequestAction(
  slug: string,
  postId: string,
): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'post:update');
    const result = await db.post.updateMany({
      where: { id: postId, workspaceId: ctx.workspace.id, status: 'PENDING_APPROVAL' },
      data: { status: 'DRAFT' },
    });
    if (!result.count) throw conflict('This post is no longer waiting for approval.');
    await notifyRoles(ctx.workspace.id, ['OWNER', 'ADMIN'], {
      type: 'APPROVAL_COMPLETED',
      title: 'An approval request was cancelled',
      body: 'The author returned the post to drafts.',
      href: `/w/${slug}/posts/${postId}`,
    });
    revalidatePath(`/w/${slug}/team`);
    revalidatePath(`/w/${slug}/posts/${postId}`);
    revalidatePath(`/w/${slug}/compose/${postId}`);
    return actionSuccess('Approval request cancelled. The post is now a draft.');
  } catch (error) {
    return actionError(error, 'The approval request could not be cancelled.');
  }
}
