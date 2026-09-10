import { describe, expect, it, vi } from 'vitest';
import { PlatformError } from '@/lib/social/errors';

const dbMock = vi.hoisted(() => ({
  job: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
const getHandlerMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/queue/handlers', () => ({ getHandler: getHandlerMock }));

import { isPermanent, PermanentJobError, runJob } from '@/lib/queue/runner';

describe('queue error classification', () => {
  it('stops retrying provider errors marked non-retryable', () => {
    const error = new PlatformError({
      platform: 'MOCK',
      code: 'REJECTED',
      message: 'Rejected.',
      retryable: false,
    });
    expect(isPermanent(error)).toBe(true);
  });

  it('continues retrying transient provider errors', () => {
    const error = new PlatformError({
      platform: 'MOCK',
      code: 'UPSTREAM',
      message: 'Unavailable.',
      retryable: true,
    });
    expect(isPermanent(error)).toBe(false);
    expect(isPermanent(new PermanentJobError('Stop.'))).toBe(true);
  });

  it('finishes a non-retryable provider job without scheduling another attempt', async () => {
    const error = new PlatformError({
      platform: 'MOCK',
      code: 'REJECTED',
      message: 'Rejected.',
      retryable: false,
    });
    dbMock.job.updateMany.mockResolvedValue({ count: 1 });
    dbMock.job.findUnique.mockResolvedValue({
      id: 'job-1',
      type: 'publish-post',
      payload: {},
      attempts: 1,
      maxAttempts: 5,
    });
    getHandlerMock.mockReturnValue(vi.fn().mockRejectedValue(error));

    await runJob('job-1');

    expect(dbMock.job.update).toHaveBeenLastCalledWith({
      where: { id: 'job-1' },
      data: {
        status: 'FAILED',
        dedupeKey: null,
        error: 'Rejected.',
        completedAt: expect.any(Date),
      },
    });
  });
});
