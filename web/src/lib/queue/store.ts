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
