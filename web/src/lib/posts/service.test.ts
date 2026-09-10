import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform, PostStatus } from '@prisma/client';

const mocks = vi.hoisted(() => {
  const tx = {
    post: {
      create: vi.fn(),
      update: vi.fn(),
    },
    postPlatform: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    postMedia: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    mediaAsset: {
      update: vi.fn(),
    },
  };
  return {
    tx,
    findFirstSocialAccount: vi.fn(),
    findManyMedia: vi.fn(),
    findFirstPost: vi.fn(),
    findFirstCampaign: vi.fn(),
    postCount: vi.fn(),
    transaction: vi.fn(),
    audit: vi.fn(),
    notifyRoles: vi.fn(),
    assertWithinLimit: vi.fn(),
    validatePost: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    socialAccount: { findFirst: mocks.findFirstSocialAccount },
    mediaAsset: { findMany: mocks.findManyMedia },
    post: {
      findFirst: mocks.findFirstPost,
      count: mocks.postCount,
    },
    campaign: { findFirst: mocks.findFirstCampaign },
    workspace: { findUniqueOrThrow: vi.fn().mockResolvedValue({ slug: 'acme' }) },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('@/lib/notifications/service', () => ({ notifyRoles: mocks.notifyRoles }));
vi.mock('@/lib/billing/limits', () => ({ assertWithinLimit: mocks.assertWithinLimit }));
vi.mock('@/lib/social/registry', () => ({
  getAdapterForAccount: () => ({ validatePost: mocks.validatePost }),
}));

import { assertPostNotLive, savePost } from '@/lib/posts/service';
import { AppError } from '@/lib/errors';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const authorId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const mediaId = '44444444-4444-4444-8444-444444444444';
const postId = '55555555-5555-4555-8555-555555555555';

const baseInput = {
  title: 'Launch note',
  campaignId: null,
  timezone: 'UTC',
  status: PostStatus.DRAFT,
  scheduledAt: null,
  platforms: [
    {
      socialAccountId: accountId,
      platform: Platform.MOCK,
      text: 'Hello from the composer',
      firstComment: null,
      hashtags: ['launch'],
      mentions: [],
      link: null,
      media: [],
    },
  ],
};

describe('savePost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirstSocialAccount.mockResolvedValue({
      id: accountId,
      workspaceId,
      platform: Platform.MOCK,
      status: 'ACTIVE',
    });
    mocks.findManyMedia.mockResolvedValue([]);
    mocks.findFirstPost.mockResolvedValue(null);
    mocks.findFirstCampaign.mockResolvedValue(null);
    mocks.postCount.mockResolvedValue(0);
    mocks.assertWithinLimit.mockResolvedValue(undefined);
    mocks.validatePost.mockReturnValue([]);
    mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) =>
      callback(mocks.tx),
    );
    mocks.tx.post.create.mockResolvedValue({
      id: postId,
      status: PostStatus.DRAFT,
      workspaceId,
    });
    mocks.tx.post.update.mockResolvedValue({
      id: postId,
      status: PostStatus.DRAFT,
      workspaceId,
    });
    mocks.tx.postPlatform.create.mockResolvedValue({ id: 'platform-1' });
    mocks.tx.postMedia.findMany.mockResolvedValue([]);
    mocks.tx.postMedia.createMany.mockResolvedValue({ count: 0 });
    mocks.tx.mediaAsset.update.mockResolvedValue({});
  });

  it('creates a draft post for the workspace', async () => {
    const result = await savePost(workspaceId, authorId, baseInput);
    expect(result.id).toBe(postId);
    expect(mocks.tx.post.create).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'post.created', workspaceId }),
    );
  });

  it('updates an existing draft in place', async () => {
    mocks.findFirstPost.mockResolvedValue({
      id: postId,
      status: PostStatus.DRAFT,
      platforms: [{ status: 'PENDING' }],
    });
    const result = await savePost(workspaceId, authorId, { ...baseInput, id: postId });
    expect(result.id).toBe(postId);
    expect(mocks.tx.post.update).toHaveBeenCalled();
    expect(mocks.tx.postPlatform.deleteMany).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'post.updated' }),
    );
  });

  it('duplicates a published post as a new draft instead of mutating it', async () => {
    mocks.findFirstPost.mockResolvedValue({
      id: postId,
      status: PostStatus.PUBLISHED,
      platforms: [{ status: 'PUBLISHED' }],
    });
    await savePost(workspaceId, authorId, { ...baseInput, id: postId });
    expect(mocks.tx.post.create).toHaveBeenCalled();
    expect(mocks.tx.post.update).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'post.duplicated' }),
    );
  });

  it('returns field errors keyed by social account id', async () => {
    mocks.validatePost.mockReturnValue([
      { severity: 'error', field: 'text', message: 'Caption is too long.' },
    ]);
    await expect(savePost(workspaceId, authorId, baseInput)).rejects.toMatchObject({
      code: 'VALIDATION',
      fields: { [accountId]: ['Caption is too long.'] },
    });
  });

  it('rejects social accounts from another workspace', async () => {
    mocks.findFirstSocialAccount.mockResolvedValue(null);
    await expect(savePost(workspaceId, authorId, baseInput)).rejects.toBeInstanceOf(AppError);
    await expect(savePost(workspaceId, authorId, baseInput)).rejects.toMatchObject({
      fields: { [accountId]: ['That social account is not connected to this workspace.'] },
    });
  });
});

describe('assertPostNotLive', () => {
  it('allows a post that has not gone out yet, in either direction', () => {
    for (const status of [
      PostStatus.DRAFT,
      PostStatus.PENDING_APPROVAL,
      PostStatus.APPROVED,
      PostStatus.SCHEDULED,
      PostStatus.FAILED,
      PostStatus.CANCELLED,
    ]) {
      expect(() => assertPostNotLive({ status })).not.toThrow();
      expect(() => assertPostNotLive({ status }, 'publish')).not.toThrow();
    }
  });

  it('refuses to re-date a post that is published or publishing', () => {
    expect(() => assertPostNotLive({ status: PostStatus.PUBLISHED })).toThrow(/already been published/);
    expect(() => assertPostNotLive({ status: PostStatus.PUBLISHING })).toThrow(/publishing right now/);
  });

  it('refuses to publish a post that is already live', () => {
    expect(() => assertPostNotLive({ status: PostStatus.PUBLISHED }, 'publish')).toThrow(/already been published/);
    expect(() => assertPostNotLive({ status: PostStatus.PUBLISHING }, 'publish')).toThrow(/already publishing/);
  });
});
