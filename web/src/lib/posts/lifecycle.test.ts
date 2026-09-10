import { describe, expect, it, vi } from 'vitest';
import { PostStatus } from '@prisma/client';
import {
  applyCancelledRestore,
  applyGuardedReschedule,
  friendlyPublishFailure,
  isComposerIntentLegal,
  legalPostActions,
  parseComposerContext,
} from '@/lib/posts/lifecycle';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const campaignId = '22222222-2222-4222-8222-222222222222';
const assetId = '33333333-3333-4333-8333-333333333333';
const postId = '44444444-4444-4444-8444-444444444444';

describe('post lifecycle matrix', () => {
  it.each([
    [PostStatus.DRAFT, ['edit', 'submitForApproval', 'schedule', 'publish', 'duplicate', 'delete']],
    [PostStatus.PENDING_APPROVAL, ['edit', 'withdrawApproval', 'duplicate', 'delete']],
    [PostStatus.APPROVED, ['edit', 'schedule', 'publish', 'duplicate', 'delete']],
    [PostStatus.SCHEDULED, ['edit', 'publish', 'reschedule', 'cancel', 'duplicate', 'delete']],
    [PostStatus.PUBLISHING, []],
    [PostStatus.PUBLISHED, ['edit', 'duplicate', 'delete']],
    [PostStatus.FAILED, ['edit', 'retry', 'reschedule', 'cancel', 'duplicate', 'delete']],
    [PostStatus.CANCELLED, ['restore', 'publish', 'duplicate', 'delete']],
  ])('offers exactly the legal actions for %s', (status, actions) => {
    expect(legalPostActions(status)).toEqual(actions);
  });

  it.each([
    [PostStatus.DRAFT, { draft: true, approval: true, schedule: true, publish: true }],
    [PostStatus.PENDING_APPROVAL, { draft: true, approval: false, schedule: false, publish: false }],
    [PostStatus.APPROVED, { draft: true, approval: false, schedule: true, publish: true }],
    [PostStatus.SCHEDULED, { draft: true, approval: false, schedule: true, publish: true }],
    [PostStatus.PUBLISHING, { draft: false, approval: false, schedule: false, publish: false }],
    [PostStatus.PUBLISHED, { draft: true, approval: false, schedule: false, publish: false }],
    [PostStatus.FAILED, { draft: true, approval: false, schedule: true, publish: false }],
    [PostStatus.CANCELLED, { draft: false, approval: false, schedule: false, publish: true }],
  ] as const)('enforces composer intents for %s', (status, expected) => {
    for (const [intent, legal] of Object.entries(expected)) {
      expect(isComposerIntentLegal(status, intent as keyof typeof expected)).toBe(legal);
    }
  });
});

describe('composer context parsing', () => {
  const available = { campaignIds: [campaignId], assetIds: [assetId] };
  const now = new Date('2026-09-10T12:00:00.000Z');

  it('accepts available associations and a bounded local datetime', () => {
    expect(parseComposerContext({
      scheduledAt: '2026-09-20T09:30',
      campaign: campaignId,
      asset: assetId,
    }, available, now)).toEqual({
      scheduledAt: '2026-09-20T09:30',
      campaignId,
      assetId,
    });
  });

  it.each([
    'not-a-date',
    '2026-02-30T09:30',
    '2026-09-20T24:00',
    '2040-09-20T09:30',
  ])('drops malformed or out-of-range datetime %s', (scheduledAt) => {
    expect(parseComposerContext({ scheduledAt }, available, now)).toEqual({});
  });

  it('drops unknown, malformed, and cross-workspace ids', () => {
    expect(parseComposerContext({
      campaign: assetId,
      asset: 'bad',
    }, available, now)).toEqual({});
  });
});

describe('guarded post transitions', () => {
  it('refuses a reschedule when the conditional write loses a publishing race', async () => {
    const tx = {
      post: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      postPlatform: { updateMany: vi.fn() },
    };
    await expect(applyGuardedReschedule(tx as never, {
      postId,
      workspaceId,
      scheduledAt: new Date('2026-09-20T09:30:00.000Z'),
      timezone: 'UTC',
    })).rejects.toMatchObject({
      message: 'This post started publishing while its date was being changed. Its publishing time was left unchanged.',
    });
    expect(tx.postPlatform.updateMany).not.toHaveBeenCalled();
  });

  it('restores only a still-cancelled post and resets cancelled channels', async () => {
    const tx = {
      post: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      postPlatform: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    await applyCancelledRestore(tx as never, { postId, workspaceId });
    expect(tx.post.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: PostStatus.CANCELLED }),
      data: { status: PostStatus.DRAFT, scheduledAt: null },
    }));
    expect(tx.postPlatform.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'PENDING', errorMessage: null, errorCode: null },
    }));
  });

  it('refuses restore after another transition won the race', async () => {
    const tx = {
      post: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      postPlatform: { updateMany: vi.fn() },
    };
    await expect(applyCancelledRestore(tx as never, { postId, workspaceId }))
      .rejects.toThrow(/no longer cancelled/);
  });
});

describe('publishing failure copy', () => {
  it('maps machine codes to an instruction without exposing the provider value', () => {
    expect(friendlyPublishFailure('AUTH')).toBe('Reconnect this channel, then retry publishing.');
    expect(friendlyPublishFailure('provider_secret_42')).toBe(
      'Bridge88 could not determine the cause. Retry publishing.',
    );
  });
});
