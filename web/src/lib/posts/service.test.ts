import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform, PostStatus, Prisma } from '@prisma/client';

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
      updatedAt: new Date('2026-09-10T12:00:00.000Z'),
      platforms: [{ status: 'PENDING' }],
    });
    const result = await savePost(workspaceId, authorId, { ...baseInput, id: postId });
    expect(result.id).toBe(postId);
    expect(mocks.tx.post.update).toHaveBeenCalled();
    expect(mocks.tx.postPlatform.deleteMany).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'post.edited' }),
    );
  });

  it('rejects a stale editor instead of silently overwriting newer changes', async () => {
    mocks.findFirstPost.mockResolvedValue({
      id: postId,
      status: PostStatus.DRAFT,
      updatedAt: new Date('2026-09-10T12:01:00.000Z'),
      platforms: [{ status: 'PENDING' }],
    });
    await expect(
      savePost(workspaceId, authorId, {
        ...baseInput,
        id: postId,
        expectedUpdatedAt: new Date('2026-09-10T12:00:00.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('changed in another session'),
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rechecks the lifecycle action against the latest stored status', async () => {
    mocks.findFirstPost.mockResolvedValue({
      id: postId,
      status: PostStatus.CANCELLED,
      updatedAt: new Date('2026-09-10T12:01:00.000Z'),
      platforms: [{ status: 'CANCELLED' }],
    });
    await expect(
      savePost(workspaceId, authorId, { ...baseInput, id: postId }, { requiredAction: 'schedule' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('no longer available'),
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('turns a conditional-update P2025 into a readable save conflict', async () => {
    mocks.findFirstPost.mockResolvedValue({
      id: postId,
      status: PostStatus.DRAFT,
      updatedAt: new Date('2026-09-10T12:01:00.000Z'),
      platforms: [{ status: 'PENDING' }],
    });
    mocks.tx.post.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Conditional update missed', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    await expect(
      savePost(workspaceId, authorId, { ...baseInput, id: postId }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'This post changed in another session. Reload it before saving so those changes are not overwritten.',
    });
    expect(mocks.tx.postPlatform.deleteMany).not.toHaveBeenCalled();
  });

  it('duplicates a published post as a new draft instead of mutating it', async () => {
    mocks.findFirstPost.mockResolvedValue({
      id: postId,
      status: PostStatus.PUBLISHED,
      updatedAt: new Date('2026-09-10T12:00:00.000Z'),
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

  it('allows incomplete platform content to be persisted as a draft', async () => {
    mocks.validatePost.mockReturnValue([
      { severity: 'error', field: 'media', message: 'This platform requires media.' },
    ]);
    await expect(
      savePost(workspaceId, authorId, baseInput, { validateContent: false }),
    ).resolves.toMatchObject({ id: postId, status: PostStatus.DRAFT });
    expect(mocks.validatePost).not.toHaveBeenCalled();
  });

  it('rejects social accounts from another workspace', async () => {
    mocks.findFirstSocialAccount.mockResolvedValue(null);
    await expect(savePost(workspaceId, authorId, baseInput)).rejects.toBeInstanceOf(AppError);
    await expect(savePost(workspaceId, authorId, baseInput)).rejects.toMatchObject({
      fields: { [accountId]: ['That social account is not connected to this workspace.'] },
    });
  });

  it('emits the mapped approval request event with the author as actor', async () => {
    mocks.tx.post.create.mockResolvedValue({
      id: postId,
      status: PostStatus.PENDING_APPROVAL,
      title: 'Launch note',
      workspaceId,
    });
    await savePost(workspaceId, authorId, {
      ...baseInput,
      status: PostStatus.PENDING_APPROVAL,
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'approval.requested',
      entityType: 'approval',
      entityId: postId,
      workspaceId,
      userId: authorId,
    }));
  });

  it('emits post.rescheduled instead of a generic edit when the date changes', async () => {
    const previous = new Date('2026-09-15T09:00:00.000Z');
    const next = new Date('2026-09-16T09:00:00.000Z');
    mocks.findFirstPost.mockResolvedValue({
      id: postId,
      status: PostStatus.SCHEDULED,
      scheduledAt: previous,
      campaignId: null,
      updatedAt: new Date('2026-09-10T12:00:00.000Z'),
      platforms: [{ status: 'PENDING' }],
    });
    mocks.tx.post.update.mockResolvedValue({
      id: postId,
      status: PostStatus.SCHEDULED,
      workspaceId,
    });
    await savePost(workspaceId, authorId, {
      ...baseInput,
      id: postId,
      status: PostStatus.SCHEDULED,
      scheduledAt: next,
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'post.rescheduled' }));
    expect(mocks.audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'post.edited' }));
  });

  it('emits post.campaign_changed instead of a generic edit', async () => {
    mocks.findFirstPost.mockResolvedValue({
      id: postId,
      status: PostStatus.DRAFT,
      scheduledAt: null,
      campaignId: null,
      updatedAt: new Date('2026-09-10T12:00:00.000Z'),
      platforms: [{ status: 'PENDING' }],
    });
    mocks.findFirstCampaign.mockResolvedValue({ id: mediaId });
    await savePost(workspaceId, authorId, {
      ...baseInput,
      id: postId,
      campaignId: mediaId,
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'post.campaign_changed' }));
    expect(mocks.audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'post.edited' }));
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
