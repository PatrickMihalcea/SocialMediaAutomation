import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  post: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  postPlatform: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  workspace: { findUniqueOrThrow: vi.fn() },
  socialAccount: { update: vi.fn(), findUnique: vi.fn() },
}));
const enqueueMock = vi.hoisted(() => vi.fn());
const adapter = vi.hoisted(() => ({
  validatePost: vi.fn(() => []),
  publish: vi.fn(),
  getPost: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/queue', () => ({ enqueue: enqueueMock }));
vi.mock('@/lib/social/accounts', () => ({
  getUsableAccount: vi.fn(async () => ({ row: { id: 'account-1' }, account: {} })),
  markExpired: vi.fn(),
}));
vi.mock('@/lib/social/registry', () => ({ getAdapterForAccount: vi.fn(() => adapter) }));
vi.mock('@/lib/publishing/payload', () => ({ toOutgoingPost: vi.fn(async () => ({})) }));
vi.mock('@/lib/notifications/service', () => ({ notifyWorkspace: vi.fn() }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import {
  publishPostPlatform,
  scanDuePosts,
  STALE_PUBLISHING_CLAIM_MS,
} from '@/lib/publishing/engine';

describe('publishing reliability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.post.findUnique.mockResolvedValue(null);
  });

  it('only scans due posts in workspaces whose queue is running', async () => {
    dbMock.post.findMany.mockResolvedValue([{ id: 'post-1', workspaceId: 'workspace-1' }]);
    enqueueMock.mockResolvedValue('job-1');

    await expect(scanDuePosts()).resolves.toEqual({ queued: 1 });
    expect(dbMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspace: { queuePaused: false } }),
      }),
    );
  });

  it('reclaims a publishing row only after its claim becomes stale', async () => {
    const updatedAt = new Date(Date.now() - STALE_PUBLISHING_CLAIM_MS - 1_000);
    dbMock.postPlatform.findUnique.mockResolvedValue({
      id: 'platform-1',
      status: 'PUBLISHING',
      updatedAt,
      post: { status: 'PUBLISHING' },
    });
    dbMock.postPlatform.updateMany.mockResolvedValue({ count: 1 });
    dbMock.postPlatform.findUniqueOrThrow.mockResolvedValue({
      id: 'platform-1',
      postId: 'post-1',
      workspaceId: 'workspace-1',
      socialAccountId: 'account-1',
      platform: 'MOCK',
      idempotencyKey: 'idem-1',
      platformPostId: null,
      post: { title: 'Test' },
      media: [],
      socialAccount: {},
    });
    dbMock.workspace.findUniqueOrThrow.mockResolvedValue({ slug: 'northwind' });
    adapter.publish.mockResolvedValue({
      platformPostId: 'remote-1',
      publishedAt: new Date(),
    });

    await publishPostPlatform('platform-1');

    const claim = dbMock.postPlatform.updateMany.mock.calls[0]?.[0];
    expect(claim.where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'PUBLISHING',
          updatedAt: { lt: expect.any(Date) },
        }),
      ]),
    );
    expect(adapter.publish).toHaveBeenCalledOnce();
  });
});
