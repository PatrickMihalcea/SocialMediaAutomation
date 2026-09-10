import 'server-only';
import { JobStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { backoffMs, type JobType } from '@/lib/queue/types';
import { getHandler } from '@/lib/queue/handlers';

/**
 * Executes one job row and records what happened.
 *
 * Both drivers funnel through here, so retry accounting, backoff and the `jobs`
 * audit trail behave identically whether the transport is Redis or the database
 * poller. Handlers signal "this is permanent, stop retrying" by throwing an
 * error carrying `permanent: true`.
 */
export async function runJob(jobId: string): Promise<void> {
  const claimed = await db.job.updateMany({
    // Only claim a job still waiting — two workers racing means one no-ops.
    where: { id: jobId, status: { in: [JobStatus.QUEUED] } },
    data: { status: JobStatus.RUNNING, startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return;

  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return;

  const handler = getHandler(job.type as JobType);
  if (!handler) {
    await db.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        dedupeKey: null,
        error: `No handler registered for "${job.type}"`,
        completedAt: new Date(),
      },
    });
    return;
  }

  try {
    const result = await handler(job.payload as never);
    await db.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        completedAt: new Date(),
        dedupeKey: null,
        error: null,
        result: (result ?? {}) as never,
      },
    });
  } catch (error) {
    const permanent = isPermanent(error);
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = job.attempts >= job.maxAttempts;

    if (permanent || exhausted) {
      await db.job.update({
        where: { id: jobId },
        data: { status: JobStatus.FAILED, dedupeKey: null, error: message, completedAt: new Date() },
      });
      console.error(`[queue] ${job.type} failed permanently`, { jobId, message });
      return;
    }

    const delay = retryDelay(error, job.attempts);
    await db.job.update({
      where: { id: jobId },
      data: { status: JobStatus.QUEUED, error: message, runAt: new Date(Date.now() + delay) },
    });
    console.warn(`[queue] ${job.type} failed, retrying in ${Math.round(delay / 1000)}s`, { jobId, message });
  }
}

export class PermanentJobError extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export function isPermanent(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('permanent' in error && error.permanent === true) return true;
  return 'retryable' in error && error.retryable === false;
}

/** A provider that told us when to come back is obeyed over the default curve. */
function retryDelay(error: unknown, attempt: number): number {
  if (error && typeof error === 'object' && 'retryAfterSeconds' in error) {
    const seconds = Number((error as { retryAfterSeconds?: number }).retryAfterSeconds);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  return backoffMs(attempt);
}
