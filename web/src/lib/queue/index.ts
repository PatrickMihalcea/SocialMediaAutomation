import 'server-only';
import { env } from '@/lib/env';
import { BullQueue } from '@/lib/queue/bullmq';
import { InProcessQueue } from '@/lib/queue/in-process';
import type { EnqueueOptions, JobPayloadMap, JobType, QueueDriver } from '@/lib/queue/types';

const globalForQueue = globalThis as unknown as { queue?: QueueDriver };

export function queue(): QueueDriver {
  if (!globalForQueue.queue) {
    globalForQueue.queue = env.QUEUE_DRIVER === 'bullmq' ? new BullQueue() : new InProcessQueue();
  }
  return globalForQueue.queue;
}

export function enqueue<T extends JobType>(
  type: T,
  payload: JobPayloadMap[T],
  options?: EnqueueOptions,
): Promise<string> {
  return queue().enqueue(type, payload, options);
}

export type { JobType, JobPayloadMap } from '@/lib/queue/types';
