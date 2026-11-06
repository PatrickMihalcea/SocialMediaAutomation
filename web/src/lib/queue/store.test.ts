import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  job: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { reclaimLocalJobs, reclaimStaleJobs, storeJob } from '@/lib/queue/store';

describe('durable queue deduplication', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the active job for the same queue and key regardless of payload', async () => {
    dbMock.job.findFirst.mockResolvedValue({ id: 'existing-job' });

    const result = await storeJob(
      'publish-post',
      { postId: 'new-payload' },
      { dedupeKey: 'publish:post-1' },
    );

    expect(result).toEqual({ id: 'existing-job', created: false });
    expect(dbMock.job.findFirst).toHaveBeenCalledWith({
      where: {
        queue: 'POST_PUBLISHING',
        dedupeKey: 'publish:post-1',
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      select: { id: true },
    });
    expect(dbMock.job.create).not.toHaveBeenCalled();
  });

  it('stores the dedupe key on a newly-created job', async () => {
    dbMock.job.findFirst.mockResolvedValue(null);
    dbMock.job.create.mockResolvedValue({ id: 'new-job' });

    await expect(
      storeJob('publish-post', { postId: 'post-1' }, { dedupeKey: 'publish:post-1' }),
    ).resolves.toEqual({ id: 'new-job', created: true });
    expect(dbMock.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          queue: 'POST_PUBLISHING',
          dedupeKey: 'publish:post-1',
        }),
      }),
    );
  });
});

/**
 * A process that dies between claiming a job and finishing it leaves the row
 * RUNNING with nobody behind it. That costs twice: the job never runs, and
 * because a RUNNING row counts as an active duplicate above, it also blocks
 * every later dispatch sharing its key — so the step it belongs to sits QUEUED
 * for good and the run never finishes.
 *
 * The recovery existed, but only inside the long-lived driver's start-up, and
 * the scheduled worker never starts that driver.
 */
describe('reclaiming jobs left behind', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns jobs that have been RUNNING longer than any pass could last', async () => {
    dbMock.job.updateMany.mockResolvedValue({ count: 3 });

    expect(await reclaimStaleJobs()).toBe(3);

    const [args] = dbMock.job.updateMany.mock.calls[0];
    expect(args.where.status).toBe('RUNNING');
    expect(args.data).toEqual({ status: 'QUEUED' });
  });

  it('leaves a job that started recently alone', async () => {
    dbMock.job.updateMany.mockResolvedValue({ count: 0 });

    await reclaimStaleJobs();

    const [args] = dbMock.job.updateMany.mock.calls[0];
    const cutoff = args.where.startedAt.lt as Date;
    const age = Date.now() - cutoff.getTime();
    // Older than the worker's own ten-minute budget, so a job still running
    // inside a live pass is never taken from it.
    expect(age).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });
});

/**
 * ComfyUI work lives on a queue only the operator's Mac consumes. A shared
 * worker reclaiming it would hand a render that is still running on the laptop
 * to the next consumer — and the only next consumer is that same laptop.
 */
describe('the local queue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores a job on the queue the caller names, over the type\'s usual one', async () => {
    dbMock.job.findFirst.mockResolvedValue(null);
    dbMock.job.create.mockResolvedValue({ id: 'local-job' });

    await storeJob('run-workflow-node', { nodeRunId: 'n1' }, { queue: 'LOCAL_GENERATION', dedupeKey: 'k' });

    expect(dbMock.job.findFirst.mock.calls[0][0].where.queue).toBe('LOCAL_GENERATION');
    expect(dbMock.job.create.mock.calls[0][0].data.queue).toBe('LOCAL_GENERATION');
  });

  it('is never reclaimed on the shared timer', async () => {
    dbMock.job.updateMany.mockResolvedValue({ count: 0 });

    await reclaimStaleJobs();

    expect(dbMock.job.updateMany.mock.calls[0][0].where.queue).toEqual({ not: 'LOCAL_GENERATION' });
  });

  it('is reclaimed whole by the local worker on start, however long it ran', async () => {
    dbMock.job.updateMany.mockResolvedValue({ count: 2 });

    expect(await reclaimLocalJobs()).toBe(2);

    const [args] = dbMock.job.updateMany.mock.calls[0];
    expect(args.where).toEqual({ queue: 'LOCAL_GENERATION', status: 'RUNNING' });
    expect(args.data).toEqual({ status: 'QUEUED' });
  });
});
