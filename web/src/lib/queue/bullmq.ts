import 'server-only';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { JobStatus, QueueName } from '@prisma/client';
import { db } from '@/lib/db';
import { getRedis } from '@/lib/queue/redis';
import { type EnqueueOptions, type JobPayloadMap, type JobType, type QueueDriver } from '@/lib/queue/types';
import { runJob } from '@/lib/queue/runner';
import { storeJob } from '@/lib/queue/store';

const QUEUE_NAMES = Object.values(QueueName);

/**
 * Redis-backed transport. The `jobs` table stays the record of what ran and why
 * it failed — BullMQ carries only the job id, so the admin view and the retry
 * accounting do not depend on which transport is active.
 */
export class BullQueue implements QueueDriver {
  readonly name = 'bullmq' as const;
  private queues = new Map<QueueName, Queue>();
  private workers: Worker[] = [];

  private queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: getRedis() });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueue<T extends JobType>(
    type: T,
    payload: JobPayloadMap[T],
    options: EnqueueOptions = {},
  ): Promise<string> {
    const stored = await storeJob(type, payload, options);
    if (!stored.created) return stored.id;

    const job = await db.job.findUniqueOrThrow({
      where: { id: stored.id },
      select: { id: true, queue: true },
    });

    const jobOptions: JobsOptions = {
      // Retries are decided by runJob against the database row, so BullMQ itself
      // delivers once and never re-attempts on its own.
      attempts: 1,
      removeOnComplete: 500,
      removeOnFail: 1000,
      // Durable deduplication is handled by storeJob. A unique transport id
      // avoids BullMQ retaining an old logical dedupe key after completion.
      jobId: job.id,
      ...(options.runAt ? { delay: Math.max(0, options.runAt.getTime() - Date.now()) } : {}),
    };

    const enqueued = await this.queue(job.queue).add(type, { jobId: job.id }, jobOptions);
    await db.job.update({ where: { id: job.id }, data: { externalId: String(enqueued.id) } });
    return job.id;
  }

  /** Called by the worker process only; the web process just enqueues. */
  async start(): Promise<void> {
    if (this.workers.length) return;
    for (const name of QUEUE_NAMES) {
      const worker = new Worker(
        name,
        async (job) => {
          await runJob((job.data as { jobId: string }).jobId);
        },
        { connection: getRedis(), concurrency: name === QueueName.POST_PUBLISHING ? 5 : 3 },
      );
      worker.on('failed', (job, err) => console.error(`[bullmq:${name}] job ${job?.id} failed`, err));
      this.workers.push(worker);
    }

    // Jobs that runJob rescheduled (status back to QUEUED with a future runAt)
    // need re-delivering; a repeatable sweep picks them up.
    const sweeper = new Queue(QueueName.POST_PUBLISHING, { connection: getRedis() });
    await sweeper.add('sweep', { sweep: true }, { repeat: { every: 15_000 }, jobId: 'retry-sweeper' });
    const sweepWorker = new Worker(
      QueueName.POST_PUBLISHING,
      async (job) => {
        if (!(job.data as { sweep?: boolean }).sweep) return;
        const due = await db.job.findMany({
          where: { status: JobStatus.QUEUED, runAt: { lte: new Date() }, externalId: { not: null } },
          take: 25,
          select: { id: true },
        });
        await Promise.all(due.map((d) => runJob(d.id)));
      },
      { connection: getRedis(), concurrency: 1 },
    );
    this.workers.push(sweepWorker);

    console.log('[queue] bullmq workers started');
  }

  async stop(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.workers = [];
    this.queues.clear();
  }
}
