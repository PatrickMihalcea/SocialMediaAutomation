'use server';

import { RecurrenceStatus } from '@prisma/client';
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
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1),
  hour: z.coerce.number().int().min(0).max(23),
  minute: z.coerce.number().int().min(0).max(59),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
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
  return input;
}

function refresh(slug: string) {
  revalidatePath(`/w/${slug}/queue`);
  revalidatePath(`/w/${slug}/calendar`);
}

export async function createRecurrenceAction(slug: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'schedule:manage');
  const input = parse(formData);
  const account = await db.socialAccount.findFirst({
    where: { id: input.socialAccountId, workspaceId: ctx.workspace.id },
    select: { id: true, platform: true },
  });
  if (!account) throw invalid('Choose a connected account.');
  const template: RecurrenceTemplate = {
    title: input.title,
    campaignId: input.campaignId,
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
  const account = await db.socialAccount.findFirst({
    where: { id: input.socialAccountId, workspaceId: ctx.workspace.id },
    select: { id: true, platform: true },
  });
  if (!account) throw invalid('Choose a connected account.');
  const template: RecurrenceTemplate = {
    title: input.title,
    campaignId: input.campaignId,
    platforms: [{ socialAccountId: account.id, platform: account.platform, text: input.text }],
  };
  const result = await db.recurringSchedule.updateMany({
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
  const result = await db.recurringSchedule.updateMany({
    where: { id: recurrenceId, workspaceId: ctx.workspace.id },
    data: { status },
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
  await db.recurringSchedule.deleteMany({ where: { id: recurrenceId, workspaceId: ctx.workspace.id } });
  refresh(slug);
}
