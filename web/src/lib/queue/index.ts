import 'server-only';
import { env } from '@/lib/env';
import { BullQueue } from '@/lib/queue/bullmq';
import { InProcessQueue } from '@/lib/queue/in-process';
import { wakeRemoteWorker } from '@/lib/queue/wake-remote-worker';
import type { EnqueueOptions, JobPayloadMap, JobType, QueueDriver } from '@/lib/queue/types';

const globalForQueue = globalThis as unknown as { queue?: QueueDriver };

export function queue(): QueueDriver {
  if (!globalForQueue.queue) {
    globalForQueue.queue = env.QUEUE_DRIVER === 'bullmq' ? new BullQueue() : new InProcessQueue();
  }
  return globalForQueue.queue;
}

export async function enqueue<T extends JobType>(
  type: T,
  payload: JobPayloadMap[T],
  options?: EnqueueOptions,
): Promise<string> {
  const id = await queue().enqueue(type, payload, options);
  // Not awaited: whoever called enqueue() is waiting on the row being
  // written, not on GitHub's response. See wake-remote-worker.ts for why this
  // can never turn into a failure for the caller.
  void wakeRemoteWorker();
  return id;
}

export type { JobType, JobPayloadMap } from '@/lib/queue/types';
