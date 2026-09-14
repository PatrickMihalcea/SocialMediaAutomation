import 'server-only';
import { JobStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { type EnqueueOptions, type JobPayloadMap, type JobType, type QueueDriver } from '@/lib/queue/types';
import { runJob } from '@/lib/queue/runner';
import { storeJob } from '@/lib/queue/store';

const POLL_INTERVAL_MS = 2000;
const CONCURRENCY = 4;

/**
 * Database-backed queue for development and small single-instance deployments.
 *
 * The `jobs` table is the queue: rows are claimed with a conditional update, so
 * even this driver is safe to run in more than one process. It is not a
 * replacement for Redis under load — it polls — but it means the whole product,
 * publishing included, works with nothing installed but Postgres.
 */
export class InProcessQueue implements QueueDriver {
  readonly name = 'in-process' as const;
  private timer: NodeJS.Timeout | null = null;
  /**
   * Jobs executing right now. This is a set rather than a boolean because a
   * boolean made the whole queue serial: one slow job — a video render, a
   * chunked upload — held the flag and stalled every other job in the process,
   * publishing included. Each tick now tops the set back up to CONCURRENCY.
   */
  private inFlight = new Set<string>();

  async enqueue<T extends JobType>(
    type: T,
    payload: JobPayloadMap[T],
    options: EnqueueOptions = {},
  ): Promise<string> {
    return (await storeJob(type, payload, options)).id;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    console.log('[queue] in-process driver started');
    this.timer = setInterval(() => void this.drain(), POLL_INTERVAL_MS);
    // Recover jobs left RUNNING by a process that died mid-flight.
    await db.job
      .updateMany({
        where: { status: JobStatus.RUNNING, startedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
        data: { status: JobStatus.QUEUED },
      })
      .catch(() => {});
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Starts as many jobs as there is spare capacity for and returns immediately —
   * it does not wait for them. A long job occupies one slot until it settles;
   * the remaining slots keep serving everything else.
   */
  private async drain(): Promise<void> {
    const capacity = CONCURRENCY - this.inFlight.size;
    if (capacity <= 0) return;

    try {
      const due = await db.job.findMany({
        where: { status: JobStatus.QUEUED, runAt: { lte: new Date() } },
        orderBy: { runAt: 'asc' },
        // Over-fetch a little: a row picked here may be claimed by another
        // process before runJob reaches it, and that attempt costs nothing.
        take: capacity + 2,
        select: { id: true },
      });

      for (const job of due) {
        if (this.inFlight.size >= CONCURRENCY) break;
        if (this.inFlight.has(job.id)) continue;
        this.inFlight.add(job.id);
        // Deliberately not awaited. runJob claims the row conditionally, so a
        // job another worker already took resolves immediately as a no-op.
        void runJob(job.id)
          .catch((error) => console.error('[queue] job failed outside the runner', job.id, error))
          .finally(() => this.inFlight.delete(job.id));
      }
    } catch (error) {
      console.error('[queue] drain failed', error);
    }
  }
}
