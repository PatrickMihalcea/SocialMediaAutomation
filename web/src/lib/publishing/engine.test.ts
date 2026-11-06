import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformError } from '@/lib/social/errors';

const dbMock = vi.hoisted(() => ({
  post: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  postPlatform: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(async (): Promise<unknown[]> => []),
  },
  workspace: { findUniqueOrThrow: vi.fn() },
  socialAccount: { update: vi.fn(), findUnique: vi.fn() },
}));
const enqueueMock = vi.hoisted(() => vi.fn());
const notifyWorkspaceMock = vi.hoisted(() => vi.fn());
const auditMock = vi.hoisted(() => vi.fn());
const adapter = vi.hoisted(() => ({
  validatePost: vi.fn(() => []),
  publish: vi.fn(),
  getPost: vi.fn(),
  deletePost: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/queue', () => ({ enqueue: enqueueMock }));
vi.mock('@/lib/social/accounts', () => ({
  getUsableAccount: vi.fn(async () => ({ row: { id: 'account-1' }, account: {} })),
  markExpired: vi.fn(),
}));
vi.mock('@/lib/social/registry', () => ({ getAdapterForAccount: vi.fn(() => adapter) }));
vi.mock('@/lib/publishing/payload', () => ({ toOutgoingPost: vi.fn(async () => ({})) }));
vi.mock('@/lib/notifications/service', () => ({ notifyWorkspace: notifyWorkspaceMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/posts/service', () => ({ assertStoredPostValid: vi.fn() }));

import {
  publishPost,
  publishPostPlatform,
  reconcilePostStatus,
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

  it('retries only channel rows that have not published', async () => {
    dbMock.post.findUnique.mockResolvedValue({
      id: 'post-1',
      workspaceId: 'workspace-1',
      status: 'FAILED',
      platforms: [
        { id: 'instagram-row', status: 'PUBLISHED' },
        { id: 'linkedin-row', status: 'FAILED' },
        { id: 'x-row', status: 'PUBLISHED' },
      ],
    });
    dbMock.post.update.mockResolvedValue({});
    enqueueMock.mockResolvedValue('job-1');

    await publishPost('post-1');

    expect(enqueueMock).toHaveBeenCalledOnce();
    expect(enqueueMock).toHaveBeenCalledWith(
      'publish-post-platform',
      { postPlatformId: 'linkedin-row' },
      { workspaceId: 'workspace-1' },
    );
  });

  it('discloses fully simulated publishing in the success notification', async () => {
    dbMock.post.findUnique.mockResolvedValue({
      id: 'post-1',
      workspaceId: 'workspace-1',
      title: 'Campaign update',
      publishedAt: null,
      workspace: { slug: 'northwind' },
      platforms: [
        {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          socialAccount: { metadata: { mock: true } },
        },
      ],
    });
    dbMock.post.update.mockResolvedValue({});

    await reconcilePostStatus('post-1');

    expect(notifyWorkspaceMock).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        body: expect.stringContaining('no post was sent to a real social network'),
        href: '/w/northwind/calendar?post=post-1',
      }),
    );
  });

  it('maps expired authorization to a human history reason', async () => {
    dbMock.postPlatform.findUnique.mockResolvedValue({
      id: 'platform-1',
      status: 'PENDING',
      post: { status: 'PUBLISHING' },
    });
    dbMock.postPlatform.updateMany.mockResolvedValue({ count: 1 });
    dbMock.postPlatform.findUniqueOrThrow.mockResolvedValue({
      id: 'platform-1',
      postId: 'post-1',
      workspaceId: 'workspace-1',
      socialAccountId: 'account-1',
      platform: 'LINKEDIN',
      attempts: 1,
      idempotencyKey: 'idem-1',
      platformPostId: null,
      post: { title: 'Test' },
      media: [],
      socialAccount: {},
    });
    dbMock.workspace.findUniqueOrThrow.mockResolvedValue({ slug: 'northwind' });
    dbMock.socialAccount.findUnique.mockResolvedValue({ id: 'account-1' });
    adapter.publish.mockRejectedValue(new PlatformError({
      platform: 'LINKEDIN',
      code: 'AUTH',
      needsReconnect: true,
      message: 'LinkedIn authorization expired. Reconnect LinkedIn to continue publishing.',
    }));

    await expect(publishPostPlatform('platform-1')).rejects.toMatchObject({ code: 'AUTH' });

    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'post.publish_failed',
      metadata: expect.objectContaining({
        platform: 'LINKEDIN',
        error: 'TOKEN_EXPIRED',
      }),
    }));
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

/**
 * A Reel reposted to replace a plain Facebook video takes the old video down
 * once it is itself live, so the Page never shows both — and never neither.
 */
describe('retiring the post a repost replaces', () => {
  const publishing = () => {
    dbMock.postPlatform.findUnique.mockResolvedValue({ id: 'reel-row', status: 'PENDING', post: { status: 'PUBLISHING' } });
    dbMock.postPlatform.updateMany.mockResolvedValue({ count: 1 });
    dbMock.postPlatform.findUniqueOrThrow.mockResolvedValue({
      id: 'reel-row',
      postId: 'post-2',
      workspaceId: 'workspace-1',
      socialAccountId: 'page-1',
      platform: 'FACEBOOK',
      attempts: 1,
      idempotencyKey: 'idem-2',
      platformPostId: null,
      post: { title: null },
      media: [],
      socialAccount: {},
    });
    dbMock.workspace.findUniqueOrThrow.mockResolvedValue({ slug: 'northwind' });
    dbMock.postPlatform.update.mockResolvedValue({});
    dbMock.post.findUnique.mockResolvedValue(null);
    adapter.publish.mockResolvedValue({ platformPostId: 'reel-9', publishedAt: new Date() });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    publishing();
  });

  it('deletes the old video once the Reel has published, on the same Page', async () => {
    dbMock.postPlatform.findMany.mockResolvedValue([
      { id: 'old-row', platformPostId: 'video-1', responseMeta: { replacedBy: 'reel-row' } },
    ]);

    await publishPostPlatform('reel-row');

    expect(dbMock.postPlatform.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { socialAccountId: 'page-1', responseMeta: { path: ['replacedBy'], equals: 'reel-row' } },
    }));
    expect(adapter.deletePost).toHaveBeenCalledWith(expect.anything(), 'video-1');
    expect(dbMock.postPlatform.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-row' },
      data: expect.objectContaining({ platformUrl: null, responseMeta: expect.objectContaining({ retiredAt: expect.any(String) }) }),
    }));
  });

  /** A failed delete must not fail the publish, or the retry posts the Reel twice. */
  it('reports the Reel published even when the delete fails, and records why', async () => {
    dbMock.postPlatform.findMany.mockResolvedValue([
      { id: 'old-row', platformPostId: 'video-1', responseMeta: { replacedBy: 'reel-row' } },
    ]);
    adapter.deletePost.mockRejectedValue(new Error('Unsupported delete request'));

    await expect(publishPostPlatform('reel-row')).resolves.toBeUndefined();

    expect(dbMock.postPlatform.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-row' },
      data: { responseMeta: expect.objectContaining({ retireError: 'Unsupported delete request' }) },
    }));
  });

  it('does not delete twice', async () => {
    dbMock.postPlatform.findMany.mockResolvedValue([
      { id: 'old-row', platformPostId: 'video-1', responseMeta: { replacedBy: 'reel-row', retiredAt: '2026-11-05T10:00:00Z' } },
    ]);

    await publishPostPlatform('reel-row');

    expect(adapter.deletePost).not.toHaveBeenCalled();
  });

  it('deletes nothing when the publish fails', async () => {
    adapter.publish.mockRejectedValue(new Error('network down'));
    dbMock.socialAccount.findUnique.mockResolvedValue({ id: 'page-1' });

    await expect(publishPostPlatform('reel-row')).rejects.toThrow();

    expect(dbMock.postPlatform.findMany).not.toHaveBeenCalled();
    expect(adapter.deletePost).not.toHaveBeenCalled();
  });
});
