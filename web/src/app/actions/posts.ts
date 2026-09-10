'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { PostStatus } from '@prisma/client';
import { z } from 'zod';
import { assertCan, requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { invalid, toAppError } from '@/lib/errors';
import {
  assertPostNotLive,
  assertStoredPostValid,
  deletePost,
  duplicatePost,
  savePost,
} from '@/lib/posts/service';
import { postPlatformInputSchema } from '@/lib/posts/schemas';
import {
  applyCancelledRestore,
  applyGuardedReschedule,
  friendlyPublishFailure,
  isPostActionLegal,
} from '@/lib/posts/lifecycle';
import { formatInZone, localInputToUtc } from '@/lib/scheduling/time';
import { enqueue } from '@/lib/queue';
import { actionError, actionSuccess, type ActionState } from '@/lib/actions/state';
import { PLATFORM_LABELS } from '@/lib/social/labels';

/**
 * The composer keeps the user on the page when a post cannot be saved, so this
 * action reports problems as state instead of throwing. `fields` is keyed by
 * social account id to match the per-platform issues from validateDraft().
 */
export type ComposerState = ActionState & { redirectTo?: string; savedUpdatedAt?: string };
export type PostCommandState = ActionState & { redirectTo?: string };

export async function createPostAction(
  slug: string,
  _previous: ComposerState,
  formData: FormData,
): Promise<ComposerState> {
  return persistPost(slug, undefined, formData);
}

export async function updatePostAction(
  slug: string,
  postId: string,
  _previous: ComposerState,
  formData: FormData,
): Promise<ComposerState> {
  return persistPost(slug, postId, formData);
}

async function persistPost(
  slug: string,
  postId: string | undefined,
  formData: FormData,
): Promise<ComposerState> {
  try {
    const intent = String(formData.get('intent') || 'draft');
    if (!['draft', 'approval', 'schedule', 'publish'].includes(intent)) {
      throw invalid('Choose a valid post action.');
    }
    const ctx = await requireWorkspace(slug, postId ? 'post:update' : 'post:create');
    if (intent === 'approval') assertCan(ctx, 'post:submit_for_approval');
    if (intent === 'schedule') assertCan(ctx, 'post:schedule');
    if (intent === 'publish') assertCan(ctx, 'post:publish');

    const rawVersions = String(formData.get('platforms') || '');
    let decoded: unknown;
    try {
      decoded = JSON.parse(rawVersions);
    } catch {
      throw invalid('The platform drafts could not be read. Reload the composer and try again.');
    }
    const platforms = z.array(postPlatformInputSchema).min(1).parse(decoded);
    const scheduledLocal = String(formData.get('scheduledAt') || '');
    const status =
      intent === 'approval'
        ? PostStatus.PENDING_APPROVAL
        : intent === 'schedule'
          ? PostStatus.SCHEDULED
          : PostStatus.DRAFT;
    if (status === PostStatus.SCHEDULED && !scheduledLocal) {
      throw invalid(`Pick a date and time (${ctx.workspace.timezone}) before scheduling.`);
    }
    // Preserve a contextual calendar slot on drafts and approval submissions;
    // scheduling is still the only intent that requires the value.
    const scheduledAt = scheduledLocal
      ? localInputToUtc(scheduledLocal, ctx.workspace.timezone)
      : null;

    const post = await savePost(ctx.workspace.id, ctx.user.id, {
      id: postId,
      expectedUpdatedAt: formData.get('expectedUpdatedAt')
        ? new Date(String(formData.get('expectedUpdatedAt')))
        : undefined,
      title: String(formData.get('title') || '') || null,
      campaignId: String(formData.get('campaignId') || '') || null,
      timezone: ctx.workspace.timezone,
      status,
      scheduledAt,
      platforms,
    }, { validateContent: intent !== 'draft' });
    if (intent === 'publish') {
      await assertStoredPostValid(ctx.workspace.id, post.id);
      await db.post.update({
        where: { id: post.id, workspaceId: ctx.workspace.id },
        data: { status: 'SCHEDULED', scheduledAt: new Date() },
      });
      await enqueue('publish-post', { postId: post.id }, { workspaceId: ctx.workspace.id, dedupeKey: `publish:${post.id}` });
    }
    const destination =
      intent === 'schedule' || intent === 'publish'
        ? `/w/${slug}/calendar?post=${post.id}`
        : `/w/${slug}/compose/${post.id}`;
    revalidatePath(`/w/${slug}/calendar`);
    const success =
      intent === 'schedule'
        ? 'Post scheduled.'
        : intent === 'publish'
          ? 'Publishing started.'
          : 'Post saved.';
    return {
      status: 'success',
      success,
      redirectTo: destination,
      savedUpdatedAt: post.updatedAt.toISOString(),
    };
  } catch (thrown) {
    if (thrown instanceof z.ZodError) {
      return actionError(thrown, 'That post is not valid yet.');
    }
    const error = toAppError(thrown);
    if (error.code === 'INTERNAL') console.error('[composer] could not save post', error.detail);
    return { status: 'error', error: error.message, fields: error.fields };
  }
}

export async function postCommandAction(
  slug: string,
  postId: string,
  command: 'cancel' | 'delete' | 'duplicate' | 'publish' | 'retry' | 'reschedule' | 'restore',
  formData?: FormData,
): Promise<PostCommandState> {
  try {
    const clientManaged = formData?.get('clientManaged') === '1';
    const capability =
      command === 'delete'
        ? 'post:delete'
        : command === 'duplicate'
          ? 'post:create'
          : command === 'publish' || command === 'retry'
            ? 'post:publish'
            : command === 'reschedule'
              ? 'post:schedule'
              : 'post:update';
    const ctx = await requireWorkspace(slug, capability);
    const post = await db.post.findFirst({ where: { id: postId, workspaceId: ctx.workspace.id } });
    if (!post) throw invalid('That post no longer exists.');
    if (!isPostActionLegal(post.status, command)) {
      throw invalid('That action is no longer available for this post. Refresh to see its current status.');
    }
    if (command === 'delete') {
      await deletePost(ctx.workspace.id, post.id);
      revalidatePath(`/w/${slug}/calendar`);
      if (clientManaged) {
        return {
          status: 'success',
          success: 'Post deleted.',
          redirectTo: `/w/${slug}/calendar`,
        };
      }
      redirect(`/w/${slug}/calendar`);
    }
    if (command === 'duplicate') {
      const copy = await duplicatePost(ctx.workspace.id, post.id, ctx.user.id);
      revalidatePath(`/w/${slug}/calendar`);
      if (clientManaged) {
        return {
          status: 'success',
          success: 'Post duplicated.',
          redirectTo: `/w/${slug}/compose/${copy.id}`,
        };
      }
      redirect(`/w/${slug}/compose/${copy.id}`);
    }
    if (command === 'cancel') {
      if (!['SCHEDULED', 'FAILED'].includes(post.status)) {
        throw invalid('Only scheduled or failed posts can be cancelled.');
      }
      await db.post.update({ where: { id: post.id, workspaceId: ctx.workspace.id }, data: { status: 'CANCELLED' } });
      await db.postPlatform.updateMany({ where: { postId, workspaceId: ctx.workspace.id }, data: { status: 'CANCELLED' } });
    }
    if (command === 'restore') {
      await db.$transaction((tx) => applyCancelledRestore(tx, {
        postId: post.id,
        workspaceId: ctx.workspace.id,
      }));
    }
    if (command === 'reschedule') {
      const local = String(formData?.get('scheduledAt') || '');
      if (!local) throw invalid(`Pick a date and time (${ctx.workspace.timezone}) before rescheduling.`);
      const scheduledAt = localInputToUtc(local, ctx.workspace.timezone);
      assertPostNotLive(post);
      if (scheduledAt.getTime() <= Date.now()) {
        throw invalid(`${formatInZone(scheduledAt, ctx.workspace.timezone)} has already passed. Any future slot works, earlier or later than the current one.`);
      }
      await assertStoredPostValid(ctx.workspace.id, post.id);
      await db.$transaction((tx) => applyGuardedReschedule(tx, {
        postId: post.id,
        workspaceId: ctx.workspace.id,
        scheduledAt,
        timezone: ctx.workspace.timezone,
      }));
    }
    if (command === 'publish' || command === 'retry') {
      // Guards the two-tab race: the button is hidden once a post goes live, but
      // a stale tab must not re-date it to now and queue a second send.
      assertPostNotLive(post, 'publish');
      await assertStoredPostValid(ctx.workspace.id, post.id);
      await db.post.update({ where: { id: post.id, workspaceId: ctx.workspace.id }, data: { status: 'SCHEDULED', scheduledAt: new Date() } });
      await db.postPlatform.updateMany({
        where: { postId, workspaceId: ctx.workspace.id, status: { in: ['PENDING', 'FAILED', 'CANCELLED'] } },
        data: { status: 'PENDING', errorMessage: null, errorCode: null },
      });
      await enqueue('publish-post', { postId }, { workspaceId: ctx.workspace.id, dedupeKey: `publish:${post.id}` });
      if (!clientManaged) {
        revalidatePath(`/w/${slug}/calendar`);
        redirect(`/w/${slug}/calendar?post=${post.id}`);
      }
    }
    revalidatePath(`/w/${slug}/calendar`);
    return actionSuccess('Post updated.');
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return actionError(error, 'The post could not be updated.');
  }
}

export type PostPublishOutcome = {
  accountName: string;
  platformLabel: string;
  status: 'waiting' | 'publishing' | 'published' | 'failed' | 'skipped' | 'cancelled';
  statusLabel: string;
  guidance: string | null;
};

export async function getPostPublishOutcomesAction(
  slug: string,
  postId: string,
): Promise<PostPublishOutcome[]> {
  const ctx = await requireWorkspace(slug, 'post:view');
  const rows = await db.postPlatform.findMany({
    where: { postId, workspaceId: ctx.workspace.id, post: { workspaceId: ctx.workspace.id } },
    orderBy: { createdAt: 'asc' },
    select: {
      platform: true,
      status: true,
      errorCode: true,
      socialAccount: { select: { accountName: true } },
    },
  });
  const labels = {
    PENDING: ['waiting', 'Waiting'],
    PUBLISHING: ['publishing', 'Publishing'],
    PUBLISHED: ['published', 'Published'],
    FAILED: ['failed', 'Needs attention'],
    SKIPPED: ['skipped', 'Not sent'],
    CANCELLED: ['cancelled', 'Cancelled'],
  } as const;
  return rows.map((row) => ({
    accountName: row.socialAccount.accountName,
    platformLabel: PLATFORM_LABELS[row.platform],
    status: labels[row.status][0],
    statusLabel: labels[row.status][1],
    guidance: row.status === 'FAILED' ? friendlyPublishFailure(row.errorCode) : null,
  }));
}

export async function listAttachableDraftsAction(
  slug: string,
): Promise<Array<{ id: string; label: string }>> {
  const ctx = await requireWorkspace(slug, 'post:update');
  const posts = await db.post.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'FAILED', 'CANCELLED'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: { id: true, title: true, status: true },
  });
  return posts.map((post) => ({
    id: post.id,
    label: `${post.title || 'Untitled post'} · ${post.status === 'PENDING_APPROVAL' ? 'In review' : post.status.charAt(0) + post.status.slice(1).toLowerCase()}`,
  }));
}
