import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  job: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { storeJob } from '@/lib/queue/store';

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
