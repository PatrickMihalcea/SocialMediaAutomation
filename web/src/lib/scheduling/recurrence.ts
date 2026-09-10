import 'server-only';
import { PostStatus, RecurrenceStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { db } from '@/lib/db';
import { idempotencyKey } from '@/lib/publishing/idempotency';

/**
 * Recurring series never expand to infinity.
 *
 * A series materialises real Post rows only inside a rolling window, and records
 * how far it has been expanded. A daily job rolls the window forward, so "every
 * Tuesday at 09:00, no end date" produces the next few weeks of posts and
 * nothing more — each one editable and cancellable on its own.
 */
const WINDOW_DAYS = 45;

export interface RecurrenceTemplate {
  title?: string | null;
  campaignId?: string | null;
  platforms: {
    socialAccountId: string;
    platform: string;
    text: string;
    hashtags?: string[];
    mentions?: string[];
    firstComment?: string | null;
    link?: string | null;
    mediaAssetIds?: string[];
  }[];
}

export async function expandRecurrence(recurringScheduleId: string): Promise<{ created: number }> {
  const series = await db.recurringSchedule.findUnique({ where: { id: recurringScheduleId } });
  if (!series || series.status !== RecurrenceStatus.ACTIVE) return { created: 0 };

  const template = series.template as unknown as RecurrenceTemplate;
  if (!template?.platforms?.length) return { created: 0 };

  const windowEnd = DateTime.utc().plus({ days: WINDOW_DAYS });
  const hardEnd = series.endDate ? DateTime.fromJSDate(series.endDate, { zone: 'utc' }) : null;
  const until = hardEnd && hardEnd < windowEnd ? hardEnd : windowEnd;

  // Resume from wherever the last expansion stopped, never before the start.
  const startFrom = DateTime.max(
    DateTime.fromJSDate(series.expandedUntil ?? series.startDate, { zone: 'utc' }),
    DateTime.fromJSDate(series.startDate, { zone: 'utc' }),
    DateTime.utc(),
  );

  const instants = occurrencesBetween({
    from: startFrom,
    until,
    weekdays: series.weekdays,
    hour: series.hour,
    minute: series.minute,
    timezone: series.timezone,
  });

  let created = 0;
  for (const at of instants) {
    // A slot already filled by this series is left alone, so re-running the
    // expansion is safe and produces no duplicates.
    const existing = await db.post.findFirst({
      where: { recurringScheduleId: series.id, scheduledAt: at },
      select: { id: true },
    });
    if (existing) continue;

    const post = await db.post.create({
      data: {
        workspaceId: series.workspaceId,
        campaignId: template.campaignId ?? null,
        recurringScheduleId: series.id,
        title: template.title ?? series.name,
        status: PostStatus.SCHEDULED,
        scheduledAt: at,
        timezone: series.timezone,
      },
    });

    for (const platform of template.platforms) {
      const created = await db.postPlatform.create({
        data: {
          postId: post.id,
          workspaceId: series.workspaceId,
          socialAccountId: platform.socialAccountId,
          platform: platform.platform as never,
          text: platform.text,
          hashtags: platform.hashtags ?? [],
          mentions: platform.mentions ?? [],
          firstComment: platform.firstComment ?? null,
          link: platform.link ?? null,
          idempotencyKey: idempotencyKey(post.id, platform.socialAccountId),
        },
      });
      const mediaIds = platform.mediaAssetIds ?? [];
      if (mediaIds.length) {
        await db.postMedia.createMany({
          data: mediaIds.map((mediaAssetId, position) => ({
            postPlatformId: created.id,
            mediaAssetId,
            position,
          })),
        });
      }
    }
    created += 1;
  }

  await db.recurringSchedule.update({
    where: { id: series.id },
    data: {
      expandedUntil: until.toJSDate(),
      status: hardEnd && hardEnd <= DateTime.utc() ? RecurrenceStatus.ENDED : series.status,
    },
  });

  return { created };
}

export function occurrencesBetween(input: {
  from: DateTime;
  until: DateTime;
  weekdays: number[];
  hour: number;
  minute: number;
  timezone: string;
}): Date[] {
  const { weekdays, hour, minute, timezone } = input;
  if (weekdays.length === 0) return [];

  const wanted = new Set(weekdays.map((d) => (d === 0 ? 7 : d)));
  const out: Date[] = [];

  let day = input.from.setZone(timezone).startOf('day');
  const end = input.until.setZone(timezone);

  // A hard cap keeps a pathological zone/DST case from looping forever.
  for (let guard = 0; guard < 400 && day <= end; guard++, day = day.plus({ days: 1 })) {
    if (!wanted.has(day.weekday)) continue;
    const at = day.set({ hour, minute, second: 0, millisecond: 0 });
    if (at < input.from.setZone(timezone) || at > end) continue;
    out.push(at.toUTC().toJSDate());
  }
  return out;
}

/** Rolls every active series forward. Runs daily. */
export async function expandAllRecurrences(): Promise<void> {
  const series = await db.recurringSchedule.findMany({
    where: { status: RecurrenceStatus.ACTIVE },
    select: { id: true },
  });
  for (const s of series) {
    await expandRecurrence(s.id).catch((e) => console.error('[recurrence] expansion failed', s.id, e));
  }
}
