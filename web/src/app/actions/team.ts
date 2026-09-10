'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { issueSecret } from '@/lib/crypto/tokens';
import { hashSecret } from '@/lib/crypto/tokens';
import { assertWithinLimit } from '@/lib/billing/limits';
import { notifyWorkspace } from '@/lib/notifications/service';
import { sendInviteEmail } from '@/lib/notifications/email';
import { publicEnv } from '@/lib/env';
import { requireUser } from '@/lib/auth/guard';
import { redirect } from 'next/navigation';
import { actionError, actionSuccess, type ActionState } from '@/lib/actions/state';
import { conflict } from '@/lib/errors';

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
  if (!post) return;
  const body = String(formData.get('body') || '').trim() || decision.toLowerCase().replace('_', ' ');
  await db.$transaction([
    db.approvalComment.create({
      data: { postId, workspaceId: ctx.workspace.id, authorId: ctx.user.id, decision, body },
    }),
    db.post.update({
      where: { id: postId },
      data: { status: decision === 'APPROVED' ? 'APPROVED' : 'DRAFT' },
    }),
  ]);
  await notifyWorkspace(ctx.workspace.id, {
    type: 'APPROVAL_COMPLETED',
    title: decision === 'APPROVED' ? 'A post was approved' : 'A post needs changes',
    body,
    href: `/w/${slug}/calendar?post=${postId}`,
  });
  revalidatePath(`/w/${slug}/team`);
}
