import 'server-only';
import { JobStatus, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { JOB_QUEUE, type EnqueueOptions, type JobPayloadMap, type JobType } from '@/lib/queue/types';

export interface StoredJob {
  id: string;
  created: boolean;
}

/**
 * Creates the durable job row shared by both transports. The database unique
 * constraint makes deduplication safe when multiple web processes enqueue the
 * same operation concurrently.
 */
export async function storeJob<T extends JobType>(
  type: T,
  payload: JobPayloadMap[T],
  options: EnqueueOptions,
): Promise<StoredJob> {
  const queue = JOB_QUEUE[type];
  if (options.dedupeKey) {
    const active = await db.job.findFirst({
      where: {
        queue,
        dedupeKey: options.dedupeKey,
        status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
      },
      select: { id: true },
    });
    if (active) return { id: active.id, created: false };
  }

  try {
    const job = await db.job.create({
      data: {
        workspaceId: options.workspaceId ?? null,
        queue,
        type,
        dedupeKey: options.dedupeKey ?? null,
        payload: payload as never,
        runAt: options.runAt ?? new Date(),
        maxAttempts: options.maxAttempts ?? 5,
      },
      select: { id: true },
    });
    return { id: job.id, created: true };
  } catch (error) {
    if (
      options.dedupeKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const winner = await db.job.findFirst({
        where: { queue, dedupeKey: options.dedupeKey },
        select: { id: true },
      });
      if (winner) return { id: winner.id, created: false };
    }
    throw error;
  }
}

/**
 * How long a job may sit RUNNING before it is assumed to have no owner.
 *
 * Generous: the worker's own pass is capped at ten minutes and the runner
 * beneath it at twelve, so a job still RUNNING past this had its process taken
 * away rather than merely being slow. Reclaiming one that is in fact alive is
 * safe anyway — runJob's claim is conditional, so the second attempt finds the
 * row already taken and does nothing.
 */
const STALE_JOB_MS = 10 * 60 * 1000;

/**
 * Returns jobs abandoned mid-flight to the queue.
 *
 * A process that dies between claiming a job and finishing it leaves the row
 * RUNNING with nobody behind it, and nothing moves it again on its own. That
 * matters twice over: the job never runs, and `storeJob` above treats QUEUED
 * and RUNNING alike as an active duplicate — so the abandoned row also blocks
 * every later dispatch that shares its key.
 *
 * This used to live inside the long-lived driver's start-up, which the
 * scheduled worker never calls: it runs jobs through `runJob` directly. So on
 * the deployment that actually relies on it, nothing was reclaiming anything,
 * and a step whose runner was killed stayed QUEUED for good.
 */
export async function reclaimStaleJobs(): Promise<number> {
  const { count } = await db.job.updateMany({
    where: {
      status: JobStatus.RUNNING,
      startedAt: { lt: new Date(Date.now() - STALE_JOB_MS) },
    },
    data: { status: JobStatus.QUEUED },
  });
  return count;
}
