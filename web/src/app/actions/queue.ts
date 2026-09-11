'use server';

import { PostStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { invalid } from '@/lib/errors';
import { assertPostNotLive, assertStoredPostValid } from '@/lib/posts/service';
import {
  addToQueue,
  planBulkSchedule,
  removeFromQueue,
  reorderQueue,
  restoreSkippedSlot,
  setQueuePaused,
  skipNextSlot,
} from '@/lib/scheduling/queue';
import { formatInZone, localInputToUtc } from '@/lib/scheduling/time';

const slotSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  hour: z.coerce.number().int().min(0).max(23),
  minute: z.coerce.number().int().min(0).max(59),
});

function refresh(slug: string) {
  revalidatePath(`/w/${slug}/queue`);
  revalidatePath(`/w/${slug}/calendar`);
}

export async function createSlotRuleAction(slug: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  const input = slotSchema.parse(Object.fromEntries(formData));
  await db.schedulingRule.create({ data: { workspaceId: ctx.workspace.id, ...input } });
  refresh(slug);
}

export async function updateSlotRuleAction(slug: string, ruleId: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  const input = slotSchema.extend({ enabled: z.coerce.boolean() }).parse({
    ...Object.fromEntries(formData),
    enabled: formData.get('enabled') === 'on',
  });
  await db.schedulingRule.updateMany({ where: { id: ruleId, workspaceId: ctx.workspace.id }, data: input });
  refresh(slug);
}

export async function deleteSlotRuleAction(slug: string, ruleId: string) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  await db.schedulingRule.deleteMany({ where: { id: ruleId, workspaceId: ctx.workspace.id } });
  refresh(slug);
}

export async function pauseQueueAction(slug: string, paused: boolean) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  await setQueuePaused(ctx.workspace.id, paused);
  refresh(slug);
}

export async function addPostToQueueAction(slug: string, postId: string) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  const post = await db.post.findFirst({ where: { id: postId, workspaceId: ctx.workspace.id }, select: { id: true } });
  if (!post) throw invalid('That post is no longer available.');
  if (ctx.workspace.queuePaused) throw invalid('Resume the queue before adding posts.');
  await addToQueue(ctx.workspace.id, post.id);
  refresh(slug);
}

export async function removePostFromQueueAction(slug: string, postId: string) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  const item = await db.queueItem.findFirst({ where: { postId, workspaceId: ctx.workspace.id }, select: { postId: true } });
  if (!item) return;
  if (item.postId) await removeFromQueue(item.postId);
  refresh(slug);
}

export async function skipNextQueueSlotAction(slug: string) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  await skipNextSlot(ctx.workspace.id);
  refresh(slug);
}

export async function restoreSkippedQueueSlotAction(slug: string, queueItemId: string) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  await restoreSkippedSlot(ctx.workspace.id, queueItemId);
  refresh(slug);
}

export async function reorderQueueAction(slug: string, orderedPostIds: string[]) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  await reorderQueue(ctx.workspace.id, orderedPostIds);
  refresh(slug);
}

export async function previewBulkScheduleAction(slug: string, postIds: string[], startLocal?: string) {
  const ctx = await requireWorkspace(slug, 'post:schedule');
  const uniqueIds = [...new Set(postIds)].slice(0, 100);
  const count = await db.post.count({ where: { workspaceId: ctx.workspace.id, id: { in: uniqueIds } } });
  if (count !== uniqueIds.length) throw invalid('One or more selected posts are no longer available.');
  const startAt = startLocal ? localInputToUtc(startLocal, ctx.workspace.timezone) : undefined;
  const slots = await planBulkSchedule({ workspaceId: ctx.workspace.id, count, startAt });
  return slots.map((slot) => slot.toISOString());
}

export async function commitBulkScheduleAction(slug: string, postIds: string[], slotIsos: string[]) {
  const ctx = await requireWorkspace(slug, 'post:schedule');
  const uniqueIds = [...new Set(postIds)].slice(0, 100);
  if (!uniqueIds.length || uniqueIds.length !== slotIsos.length) throw invalid('Preview the bulk schedule before confirming it.');
  const posts = await db.post.findMany({ where: { workspaceId: ctx.workspace.id, id: { in: uniqueIds } }, select: { id: true, status: true } });
  if (posts.length !== uniqueIds.length) throw invalid('One or more selected posts are no longer available.');
  for (const post of posts) {
    assertPostNotLive(post);
    await assertStoredPostValid(ctx.workspace.id, post.id);
  }
  const slots = slotIsos.map((value) => new Date(value));
  if (slots.some((slot) => Number.isNaN(slot.getTime()) || slot.getTime() <= Date.now())) throw invalid('The schedule contains an invalid or past slot.');
  const collisions = await db.post.count({
    where: {
      workspaceId: ctx.workspace.id,
      id: { notIn: uniqueIds },
      scheduledAt: { in: slots },
      status: { in: ['SCHEDULED', 'APPROVED', 'PENDING_APPROVAL', 'PUBLISHING'] },
    },
  });
  if (collisions) throw invalid('A queue slot was taken after this preview. Preview the schedule again.');

  await db.$transaction(async (tx) => {
    for (const [index, id] of uniqueIds.entries()) {
      const result = await tx.post.updateMany({
        where: {
          id,
          workspaceId: ctx.workspace.id,
          status: { notIn: [PostStatus.PUBLISHED, PostStatus.PUBLISHING] },
        },
        data: { status: PostStatus.SCHEDULED, scheduledAt: slots[index], timezone: ctx.workspace.timezone },
      });
      if (result.count !== 1) {
        throw invalid('A selected post started publishing after the preview. Its date was not changed.');
      }
    }
    await tx.queueItem.deleteMany({ where: { workspaceId: ctx.workspace.id, postId: { in: uniqueIds } } });
  });
  refresh(slug);
}

export async function reschedulePostAction(slug: string, postId: string, localValue: string) {
  const ctx = await requireWorkspace(slug, 'post:schedule');
  const scheduledAt = localInputToUtc(localValue, ctx.workspace.timezone);
  const post = await db.post.findFirst({ where: { id: postId, workspaceId: ctx.workspace.id }, select: { id: true, status: true } });
  if (!post) throw invalid('That post is no longer available.');
  assertPostNotLive(post);
  if (scheduledAt.getTime() <= Date.now()) {
    throw invalid(`${formatInZone(scheduledAt, ctx.workspace.timezone)} has already passed. Any future slot works, earlier or later than the current one.`);
  }
  await assertStoredPostValid(ctx.workspace.id, post.id);
  await db.$transaction(async (tx) => {
    const result = await tx.post.updateMany({
      where: {
        id: postId,
        workspaceId: ctx.workspace.id,
        status: { notIn: [PostStatus.PUBLISHED, PostStatus.PUBLISHING] },
      },
      data: { scheduledAt, status: PostStatus.SCHEDULED, timezone: ctx.workspace.timezone },
    });
    if (result.count !== 1) {
      throw invalid('This post started publishing while its date was being changed. Its publishing time was left unchanged.');
    }
    await tx.queueItem.deleteMany({ where: { postId, workspaceId: ctx.workspace.id } });
  });
  refresh(slug);
}
