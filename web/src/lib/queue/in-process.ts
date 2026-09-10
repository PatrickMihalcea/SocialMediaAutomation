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
  private draining = false;

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

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const due = await db.job.findMany({
        where: { status: JobStatus.QUEUED, runAt: { lte: new Date() } },
        orderBy: { runAt: 'asc' },
        take: CONCURRENCY,
        select: { id: true },
      });
      await Promise.all(due.map((job) => runJob(job.id)));
    } catch (error) {
      console.error('[queue] drain failed', error);
    } finally {
      this.draining = false;
    }
  }
}
