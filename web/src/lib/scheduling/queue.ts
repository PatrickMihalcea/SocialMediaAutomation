import 'server-only';
import { PostStatus, type Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { conflict, invalid } from '@/lib/errors';
import { nextOccurrence } from '@/lib/scheduling/time';

/**
 * The smart queue.
 *
 * A workspace defines weekly slots ("Monday 09:00 and 17:00, Tuesday 09:00").
 * "Add to queue" walks forward from now, generating the slots those rules imply,
 * and takes the first one nothing already occupies. Slots are computed in the
 * workspace's zone and stored as UTC instants, so a queue built in March still
 * fires at 09:00 local in November.
 */

const HORIZON_DAYS = 120;
type QueueDb = Pick<Prisma.TransactionClient, 'workspace' | 'schedulingRule' | 'post' | 'queueItem'>;

export interface Slot {
  at: Date;
  taken: boolean;
  postId?: string;
}

export function markSlotOccupancy(instants: Date[], occupied: Map<number, string>): Slot[] {
  return instants.map((at) => ({
    at,
    taken: occupied.has(at.getTime()),
    postId: occupied.get(at.getTime()),
  }));
}

export function queueSlotsForOrder(slots: Slot[], queuedPostIds: string[], count: number): Date[] {
  const queued = new Set(queuedPostIds);
  return slots
    .filter((slot) => !slot.taken || queued.has(slot.postId ?? ''))
    .slice(0, count)
    .map((slot) => slot.at);
}

export function isCompleteQueueOrder(currentPostIds: string[], proposedPostIds: string[]): boolean {
  const current = new Set(currentPostIds);
  return (
    proposedPostIds.length === currentPostIds.length &&
    new Set(proposedPostIds).size === currentPostIds.length &&
    proposedPostIds.every((id) => current.has(id))
  );
}

export function selectBulkSlots(slots: Slot[], count: number, startAt?: Date): Date[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  return slots
    .filter((slot) => !slot.taken && (!startAt || slot.at.getTime() >= startAt.getTime()))
    .slice(0, count)
    .map((slot) => slot.at);
}

/** Every slot the rules imply between now and the horizon, marked taken or free. */
export async function listSlots(workspaceId: string, limit = 40): Promise<Slot[]> {
  return listSlotsWithClient(db, workspaceId, limit);
}

async function listSlotsWithClient(client: QueueDb, workspaceId: string, limit: number): Promise<Slot[]> {
  const workspace = await client.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { timezone: true },
  });
  const rules = await client.schedulingRule.findMany({
    where: { workspaceId, enabled: true },
    orderBy: [{ weekday: 'asc' }, { hour: 'asc' }, { minute: 'asc' }],
  });
  if (rules.length === 0) return [];

  const occupied = await occupiedInstants(client, workspaceId);
  const slots: Slot[] = [];
  const horizon = Date.now() + HORIZON_DAYS * 24 * 60 * 60 * 1000;
  let cursor = new Date();

  // Each pass takes the earliest next occurrence across all rules, so the list
  // comes out in chronological order regardless of how the rules are stored.
  while (slots.length < limit) {
    const candidates = rules.map((rule) =>
      nextOccurrence(cursor, workspace.timezone, rule.weekday, rule.hour, rule.minute),
    );
    const earliest = candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
    if (earliest.getTime() > horizon) break;

    slots.push(...markSlotOccupancy([earliest], occupied));
    cursor = earliest;
  }
  return slots;
}

export async function nextAvailableSlot(workspaceId: string, after?: Date): Promise<Date | null> {
  const slots = await listSlots(workspaceId, 200);
  const free = slots.find((s) => !s.taken && (!after || s.at.getTime() > after.getTime()));
  return free?.at ?? null;
}

/** Assigns a post the next open slot and schedules it. */
export async function addToQueue(workspaceId: string, postId: string): Promise<Date> {
  return db.$transaction(async (tx) => {
    // Serialize assignments inside a workspace. Without this, two simultaneous
    // "add" requests can both observe the same free slot and position.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { timezone: true },
    });
    const rules = await tx.schedulingRule.count({ where: { workspaceId, enabled: true } });
    if (rules === 0) {
      throw invalid('This workspace has no posting times yet. Add at least one in Queue settings.');
    }
    const slots = await listSlotsWithClient(tx, workspaceId, 200);
    const slot = slots.find((candidate) => !candidate.taken)?.at;
    if (!slot) throw conflict('Every slot in the next four months is taken. Add more posting times.');
    const position = await nextPosition(tx, workspaceId);
    const post = await tx.post.updateMany({
      where: {
        id: postId,
        workspaceId,
        status: { notIn: [PostStatus.PUBLISHED, PostStatus.PUBLISHING] },
      },
      data: { scheduledAt: slot, status: PostStatus.SCHEDULED, timezone: workspace.timezone },
    });
    if (post.count !== 1) {
      throw conflict('This post started publishing while it was being queued. Its publishing time was left unchanged.');
    }
    await tx.queueItem.upsert({
      where: { postId },
      create: { workspaceId, postId, position, slotAt: slot },
      update: { position, slotAt: slot },
    });
    return slot;
  });
}

export async function removeFromQueue(postId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const post = await tx.post.updateMany({
      where: {
        id: postId,
        status: { notIn: [PostStatus.PUBLISHED, PostStatus.PUBLISHING] },
      },
      data: { status: PostStatus.DRAFT, scheduledAt: null },
    });
    if (post.count !== 1) {
      throw conflict('This post started publishing while it was being removed. It remains in the queue.');
    }
    await tx.queueItem.deleteMany({ where: { postId } });
  });
}

/**
 * Reordering re-deals the slots: the queue is an ordered list of posts mapped
 * onto an ordered list of times, so moving a post moves everything after it.
 */
export async function reorderQueue(workspaceId: string, orderedPostIds: string[]): Promise<void> {
  const items = await db.queueItem.findMany({ where: { workspaceId } });
  const known = new Set(items.map((i) => i.postId));
  if (!isCompleteQueueOrder([...known], orderedPostIds)) {
    throw invalid('That queue order does not match the posts currently queued.');
  }

  const slots = await listSlots(workspaceId, Math.max(orderedPostIds.length + 5, 20));
  const usable = queueSlotsForOrder(slots, [...known], orderedPostIds.length);
  if (usable.length < orderedPostIds.length) {
    throw conflict('There are not enough posting times for that order. Add more slots first.');
  }

  await db.$transaction(async (tx) => {
    for (const [index, postId] of orderedPostIds.entries()) {
      const post = await tx.post.updateMany({
        where: {
          id: postId,
          workspaceId,
          status: { notIn: [PostStatus.PUBLISHED, PostStatus.PUBLISHING] },
        },
        data: { scheduledAt: usable[index] },
      });
      if (post.count !== 1) {
        throw conflict('A post started publishing while the queue was being reordered. The order was left unchanged.');
      }
      await tx.queueItem.update({
        where: { postId },
        data: { position: index, slotAt: usable[index] },
      });
    }
  });
}

export async function setQueuePaused(workspaceId: string, paused: boolean): Promise<void> {
  await db.workspace.update({ where: { id: workspaceId }, data: { queuePaused: paused } });
}

/**
 * Bulk scheduling: hand it posts and a starting point, get one queue slot each.
 * Returns the plan without writing, so the confirmation screen shows exactly
 * what will happen before anything is committed.
 */
export async function planBulkSchedule(input: {
  workspaceId: string;
  count: number;
  startAt?: Date;
}): Promise<Date[]> {
  const slots = await listSlots(input.workspaceId, input.count + 50);
  return selectBulkSlots(slots, input.count, input.startAt);
}

async function occupiedInstants(client: QueueDb, workspaceId: string): Promise<Map<number, string>> {
  const scheduled = await client.post.findMany({
    where: {
      workspaceId,
      scheduledAt: { gte: new Date() },
      status: { in: [PostStatus.SCHEDULED, PostStatus.APPROVED, PostStatus.PENDING_APPROVAL, PostStatus.PUBLISHING] },
    },
    select: { id: true, scheduledAt: true },
  });
  return new Map(scheduled.filter((p) => p.scheduledAt).map((p) => [p.scheduledAt!.getTime(), p.id]));
}

async function nextPosition(client: QueueDb, workspaceId: string): Promise<number> {
  const last = await client.queueItem.findFirst({
    where: { workspaceId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}
