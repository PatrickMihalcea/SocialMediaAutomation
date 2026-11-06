import { beforeEach, describe, expect, it, vi } from 'vitest';

const wake = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => vi.fn(async () => 'job-1'));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { QUEUE_DRIVER: 'in-process' } }));
vi.mock('@/lib/queue/wake-remote-worker', () => ({ wakeRemoteWorker: wake }));
vi.mock('@/lib/queue/in-process', () => ({
  InProcessQueue: class { enqueue = store; },
}));
vi.mock('@/lib/queue/bullmq', () => ({ BullQueue: class {} }));

const { enqueue } = await import('@/lib/queue');

describe('enqueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('wakes the cloud worker for shared work', async () => {
    await enqueue('ai-media-job', { aiMediaJobId: 'a' });
    expect(wake).toHaveBeenCalledOnce();
  });

  /** A VM started for a job it will never claim is minutes spent on nothing. */
  it('leaves the cloud worker asleep for work only the Mac can do', async () => {
    await enqueue('ai-media-job', { aiMediaJobId: 'a' }, { queue: 'LOCAL_GENERATION' });
    expect(wake).not.toHaveBeenCalled();
  });
});
