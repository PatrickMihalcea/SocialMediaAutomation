'use server';

import { PostStatus, RecurrenceStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { invalid } from '@/lib/errors';
import { enqueue } from '@/lib/queue';
import type { RecurrenceTemplate } from '@/lib/scheduling/recurrence';
import { localInputToUtc } from '@/lib/scheduling/time';

const recurrenceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().max(180).optional(),
  text: z.string().trim().min(1).max(10_000),
  socialAccountId: z.string().uuid(),
  campaignId: z.string().uuid().optional(),
  frequency: z.enum(['weekly', 'weekdays', 'monthly']).default('weekly'),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).default([]),
  hour: z.coerce.number().int().min(0).max(23),
  minute: z.coerce.number().int().min(0).max(59),
  startDate: z.string().date(),
  endDate: z.string().date().optional(),
});

function parse(formData: FormData) {
  const input = recurrenceSchema.parse({
    ...Object.fromEntries(formData),
    campaignId: String(formData.get('campaignId') || '') || undefined,
    title: String(formData.get('title') || '') || undefined,
    endDate: String(formData.get('endDate') || '') || undefined,
    weekdays: formData.getAll('weekdays'),
  });
  if (input.endDate && input.endDate < input.startDate) throw invalid('The end date must be on or after the start date.');
  if (input.frequency === 'weekly' && input.weekdays.length === 0) throw invalid('Choose at least one publishing day.');
  return {
    ...input,
    weekdays: input.frequency === 'weekdays' ? [1, 2, 3, 4, 5] : input.frequency === 'monthly' ? [] : input.weekdays,
  };
}

function refresh(slug: string) {
  revalidatePath(`/w/${slug}/queue`);
  revalidatePath(`/w/${slug}/calendar`);
}

export async function createRecurrenceAction(slug: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  const input = parse(formData);
  const [account, campaign] = await Promise.all([
    db.socialAccount.findFirst({
      where: { id: input.socialAccountId, workspaceId: ctx.workspace.id, status: 'ACTIVE' },
      select: { id: true, platform: true },
    }),
    input.campaignId
      ? db.campaign.findFirst({ where: { id: input.campaignId, workspaceId: ctx.workspace.id }, select: { id: true } })
      : null,
  ]);
  if (!account) throw invalid('Choose a connected account.');
  if (input.campaignId && !campaign) throw invalid('That campaign is no longer available. Choose another campaign.');
  const template: RecurrenceTemplate = {
    title: input.title,
    campaignId: input.campaignId,
    frequency: input.frequency,
    monthDay: Number(input.startDate.slice(-2)),
    platforms: [{ socialAccountId: account.id, platform: account.platform, text: input.text }],
  };
  const recurrence = await db.recurringSchedule.create({
    data: {
      workspaceId: ctx.workspace.id,
      name: input.name,
      template: template as never,
      weekdays: input.weekdays,
      hour: input.hour,
      minute: input.minute,
      timezone: ctx.workspace.timezone,
      startDate: localInputToUtc(`${input.startDate}T00:00`, ctx.workspace.timezone),
      endDate: input.endDate ? localInputToUtc(`${input.endDate}T23:59`, ctx.workspace.timezone) : null,
    },
  });
  await enqueue('expand-recurrence', { recurringScheduleId: recurrence.id }, {
    workspaceId: ctx.workspace.id,
    dedupeKey: `expand-recurrence:${recurrence.id}`,
  });
  refresh(slug);
}

export async function updateRecurrenceAction(slug: string, recurrenceId: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  const input = parse(formData);
  const [account, campaign] = await Promise.all([
    db.socialAccount.findFirst({
      where: { id: input.socialAccountId, workspaceId: ctx.workspace.id, status: 'ACTIVE' },
      select: { id: true, platform: true },
    }),
    input.campaignId
      ? db.campaign.findFirst({ where: { id: input.campaignId, workspaceId: ctx.workspace.id }, select: { id: true } })
      : null,
  ]);
  if (!account) throw invalid('Choose a connected account.');
  if (input.campaignId && !campaign) throw invalid('That campaign is no longer available. Choose another campaign.');
  const template: RecurrenceTemplate = {
    title: input.title,
    campaignId: input.campaignId,
    frequency: input.frequency,
    monthDay: Number(input.startDate.slice(-2)),
    platforms: [{ socialAccountId: account.id, platform: account.platform, text: input.text }],
  };
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.recurringSchedule.updateMany({
      where: { id: recurrenceId, workspaceId: ctx.workspace.id },
      data: {
        name: input.name,
        template: template as never,
        weekdays: input.weekdays,
        hour: input.hour,
        minute: input.minute,
        startDate: localInputToUtc(`${input.startDate}T00:00`, ctx.workspace.timezone),
        endDate: input.endDate ? localInputToUtc(`${input.endDate}T23:59`, ctx.workspace.timezone) : null,
        expandedUntil: null,
      },
    });
    if (updated.count) {
      // "Edit series" replaces future generated instances. Historical and
      // already-publishing posts are immutable and remain as history.
      await tx.post.deleteMany({
        where: {
          workspaceId: ctx.workspace.id,
          recurringScheduleId: recurrenceId,
          scheduledAt: { gte: new Date() },
          status: { notIn: [PostStatus.PUBLISHED, PostStatus.PUBLISHING] },
        },
      });
    }
    return updated;
  });
  if (result.count) {
    await enqueue('expand-recurrence', { recurringScheduleId: recurrenceId }, {
      workspaceId: ctx.workspace.id,
      dedupeKey: `expand-recurrence:${recurrenceId}`,
    });
  }
  refresh(slug);
}

export async function setRecurrenceStatusAction(slug: string, recurrenceId: string, paused: boolean) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  const status = paused ? RecurrenceStatus.PAUSED : RecurrenceStatus.ACTIVE;
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.recurringSchedule.updateMany({
      where: { id: recurrenceId, workspaceId: ctx.workspace.id },
      data: { status },
    });
    if (updated.count) {
      // Generated rows must follow the series state or a "paused" series would
      // continue publishing from the already-expanded window.
      await tx.post.updateMany({
        where: {
          workspaceId: ctx.workspace.id,
          recurringScheduleId: recurrenceId,
          scheduledAt: { gte: new Date() },
          status: paused ? PostStatus.SCHEDULED : PostStatus.DRAFT,
        },
        data: { status: paused ? PostStatus.DRAFT : PostStatus.SCHEDULED },
      });
    }
    return updated;
  });
  if (result.count && !paused) {
    await enqueue('expand-recurrence', { recurringScheduleId: recurrenceId }, {
      workspaceId: ctx.workspace.id,
      dedupeKey: `expand-recurrence:${recurrenceId}`,
    });
  }
  refresh(slug);
}

export async function deleteRecurrenceAction(slug: string, recurrenceId: string) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  await db.$transaction(async (tx) => {
    await tx.post.deleteMany({
      where: {
        workspaceId: ctx.workspace.id,
        recurringScheduleId: recurrenceId,
        scheduledAt: { gte: new Date() },
        status: { notIn: [PostStatus.PUBLISHED, PostStatus.PUBLISHING] },
      },
    });
    await tx.recurringSchedule.deleteMany({ where: { id: recurrenceId, workspaceId: ctx.workspace.id } });
  });
  refresh(slug);
}

export async function skipRecurrenceOccurrenceAction(slug: string, recurrenceId: string, postId: string) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  const result = await db.post.updateMany({
    where: {
      id: postId,
      workspaceId: ctx.workspace.id,
      recurringScheduleId: recurrenceId,
      status: { notIn: [PostStatus.PUBLISHED, PostStatus.PUBLISHING] },
    },
    // Keep the instant as a durable expansion marker, but CANCELLED rows are
    // ignored by the publisher and are not resumed with a paused series.
    data: { status: PostStatus.CANCELLED },
  });
  if (result.count !== 1) throw invalid('That occurrence is no longer available to skip.');
  refresh(slug);
}

export async function deleteRecurrenceOccurrenceAction(slug: string, recurrenceId: string, postId: string) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  const result = await db.post.deleteMany({
    where: {
      id: postId,
      workspaceId: ctx.workspace.id,
      recurringScheduleId: recurrenceId,
      status: { notIn: [PostStatus.PUBLISHED, PostStatus.PUBLISHING] },
    },
  });
  if (result.count !== 1) throw invalid('That occurrence is no longer available to delete.');
  refresh(slug);
}
