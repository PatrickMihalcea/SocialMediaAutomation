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
  composerActionForIntent,
  composerTargetStatus,
  friendlyPublishFailure,
  isComposerIntentLegal,
  isPostActionLegal,
  type ComposerIntent,
} from '@/lib/posts/lifecycle';
import { POST_STATUS_LABELS } from '@/lib/posts/labels';
import { formatInZone, localInputToUtc, timezoneLabel } from '@/lib/scheduling/time';
import { enqueue } from '@/lib/queue';
import { actionError, actionSuccess, type ActionState } from '@/lib/actions/state';
import { PLATFORM_LABELS } from '@/lib/social/labels';
import { storage } from '@/lib/storage';
import type { ComposerAsset } from '@/lib/posts/composer';

/**
 * The composer keeps the user on the page when a post cannot be saved, so this
 * action reports problems as state instead of throwing. `fields` is keyed by
 * social account id to match the per-platform issues from validateDraft().
 */
export type ComposerState = ActionState & { redirectTo?: string; savedUpdatedAt?: string };
export type PostCommandState = ActionState & { redirectTo?: string };

export async function setPostArchivedAction(slug: string, postId: string, archived: boolean) {
  const ctx = await requireWorkspace(slug, 'post:update');
  const result = await db.post.updateMany({
    where: {
      id: postId,
      workspaceId: ctx.workspace.id,
      ...(archived ? { status: { in: ['DRAFT', 'REJECTED', 'PUBLISHED', 'FAILED', 'CANCELLED'] } } : { archivedAt: { not: null } }),
    },
    data: { archivedAt: archived ? new Date() : null },
  });
  if (!result.count) throw invalid(archived
    ? 'Only inactive posts can be archived. Cancel or finish the post first.'
    : 'That archived post is no longer available.');
  revalidatePath(`/w/${slug}/posts/${postId}`);
  revalidatePath(`/w/${slug}/calendar`);
}

export async function createPostAction(
  slug: string,
  _previous: ComposerState,
  formData: FormData,
): Promise<ComposerState> {
  /**
   * A composer that has already saved itself sends back the id it was given,
   * so the next autosave updates that draft instead of leaving a new one behind
   * every time typing pauses.
   *
   * Safe to take from the client: persistPost scopes the lookup to the caller's
   * workspace, demands post:update when an id is present, and refuses an id
   * that is not there.
   */
  const alreadyCreated = String(formData.get('postId') || '').trim() || undefined;
  return persistPost(slug, alreadyCreated, formData);
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
    const intent = String(formData.get('intent') || 'draft') as ComposerIntent;
    if (!['draft', 'approval', 'schedule', 'publish'].includes(intent)) {
      throw invalid('Choose a valid post action.');
    }
    const ctx = await requireWorkspace(slug, postId ? 'post:update' : 'post:create');
    const source = postId
      ? await db.post.findFirst({
          where: { id: postId, workspaceId: ctx.workspace.id },
          select: { status: true },
        })
      : null;
    if (postId && !source) throw invalid('That post no longer exists.');
    if (source && !isComposerIntentLegal(source.status, intent)) {
      throw invalid(
        `This post is ${POST_STATUS_LABELS[source.status].toLowerCase()}. ${composerIntentLabel(intent)} is not available in this state. Refresh to see the current actions.`,
      );
    }
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
    const status = composerTargetStatus(source?.status, intent);
    if (status === PostStatus.SCHEDULED && !scheduledLocal) {
      throw invalid(`Pick a date and time (${timezoneLabel(ctx.workspace.timezone)}) before scheduling.`);
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
    }, {
      validateContent: intent !== 'draft',
      requiredAction: source ? composerActionForIntent(source.status, intent) : undefined,
    });
    if (intent === 'publish') {
      await assertStoredPostValid(ctx.workspace.id, post.id);
      const result = await db.post.updateMany({
        where: { id: post.id, workspaceId: ctx.workspace.id, status: post.status },
        data: { status: 'SCHEDULED', scheduledAt: new Date() },
      });
      if (result.count !== 1) {
        throw invalid('This post changed before publishing started. Refresh to see its current status.');
      }
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

function composerIntentLabel(intent: ComposerIntent) {
  return {
    draft: 'Saving changes',
    approval: 'Submitting for approval',
    schedule: 'Scheduling',
    publish: 'Publishing',
  }[intent];
}

/**
 * Deletes several drafts at once.
 *
 * Clearing out a list meant confirming one row at a time, which for a workflow
 * that produced twenty near-identical drafts is twenty confirmations for one
 * decision.
 *
 * Posts the lifecycle will not let go of are left alone rather than failing the
 * batch: a selection that happens to include a published post should still
 * delete the drafts around it, and say what it skipped.
 */
export async function deletePostsAction(slug: string, postIds: string[]) {
  const ctx = await requireWorkspace(slug, 'post:delete');
  const ids = [...new Set(postIds)].filter(Boolean);
  if (!ids.length) throw invalid('Select at least one draft.');

  const posts = await db.post.findMany({
    where: { id: { in: ids }, workspaceId: ctx.workspace.id },
    select: { id: true, status: true, title: true },
  });
  const deletable = posts.filter((post) => isPostActionLegal(post.status, 'delete'));
  if (deletable.length) {
    await db.post.deleteMany({
      where: { id: { in: deletable.map((post) => post.id) }, workspaceId: ctx.workspace.id },
    });
  }

  revalidatePath(`/w/${slug}/drafts`);
  revalidatePath(`/w/${slug}/calendar`);
  const skipped = posts.length - deletable.length;
  return {
    deleted: deletable.length,
    skipped,
    message: `${deletable.length} ${deletable.length === 1 ? 'draft' : 'drafts'} deleted.${
      skipped ? ` ${skipped} could not be deleted at ${skipped === 1 ? 'its' : 'their'} current status.` : ''
    }`,
  };
}

export async function postCommandAction(
  slug: string,
  postId: string,
  command: 'cancel' | 'delete' | 'duplicate' | 'publish' | 'retry' | 'reschedule' | 'restore',
  formData?: FormData,
  /**
   * Where the command was issued from, for deletes done out of a list.
   *
   * Deleting normally lands on the calendar, which is right when the post
   * detail page has just been deleted out from under you and wrong when you
   * are working down a list — the row should simply disappear and leave you
   * where you were. Given a path, this revalidates it and does not redirect.
   *
   * Callers are server components passing a literal, never user input, and the
   * workspace prefix below keeps it that way.
   */
  returnTo?: string,
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
      // Stay put when the delete came from a list: revalidating is enough to
      // drop the row, and a redirect would throw the reader somewhere else
      // mid-task.
      const stayOn = returnTo?.startsWith(`/w/${slug}/`) ? returnTo : null;
      if (stayOn) {
        revalidatePath(stayOn);
        return { status: 'success', success: 'Post deleted.' };
      }
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
      await db.$transaction(async (tx) => {
        const result = await tx.post.updateMany({
          where: {
            id: post.id,
            workspaceId: ctx.workspace.id,
            status: post.status,
          },
          data: { status: 'CANCELLED' },
        });
        if (result.count !== 1) {
          throw invalid('This post changed before it could be cancelled. Refresh to see its current status.');
        }
        await tx.postPlatform.updateMany({
          where: { postId, workspaceId: ctx.workspace.id },
          data: { status: 'CANCELLED' },
        });
      });
    }
    if (command === 'restore') {
      await db.$transaction((tx) => applyCancelledRestore(tx, {
        postId: post.id,
        workspaceId: ctx.workspace.id,
      }));
    }
    if (command === 'reschedule') {
      const local = String(formData?.get('scheduledAt') || '');
      if (!local) throw invalid(`Pick a date and time (${timezoneLabel(ctx.workspace.timezone)}) before rescheduling.`);
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
      await db.$transaction(async (tx) => {
        const result = await tx.post.updateMany({
          where: {
            id: post.id,
            workspaceId: ctx.workspace.id,
            status: post.status,
          },
          data: { status: 'SCHEDULED', scheduledAt: new Date() },
        });
        if (result.count !== 1) {
          throw invalid('This post changed before publishing started. Refresh to see its current status.');
        }
        await tx.postPlatform.updateMany({
          where: { postId, workspaceId: ctx.workspace.id, status: { in: ['PENDING', 'FAILED', 'CANCELLED'] } },
          data: { status: 'PENDING', errorMessage: null, errorCode: null },
        });
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
      status: { in: ['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'FAILED', 'CANCELLED'] },
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

export async function loadMoreComposerAssetsAction(
  slug: string,
  offset: number,
): Promise<{ assets: ComposerAsset[]; hasMore: boolean }> {
  const ctx = await requireWorkspace(slug, 'post:view');
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? Math.min(offset, 1_000) : 0;
  const rows = await db.mediaAsset.findMany({
    where: { workspaceId: ctx.workspace.id, status: 'READY' },
    orderBy: { createdAt: 'desc' },
    skip: safeOffset,
    take: 13,
    select: { id: true, filename: true, thumbnailKey: true, storageKey: true, type: true },
  });
  const mediaStorage = storage();
  const page = rows.slice(0, 12);
  return {
    hasMore: rows.length > page.length,
    assets: await Promise.all(page.map(async (asset) => ({
      id: asset.id,
      filename: asset.filename,
      type: asset.type,
      url: await mediaStorage.signedUrl(asset.storageKey),
      thumbnailUrl: await mediaStorage.signedUrl(asset.thumbnailKey ?? asset.storageKey),
    }))),
  };
}
