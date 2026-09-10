import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostStatus } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  requireWorkspace: vi.fn(),
  findFirst: vi.fn(),
  savePost: vi.fn(),
  deletePost: vi.fn(),
  duplicatePost: vi.fn(),
  enqueue: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/dist/client/components/redirect-error', () => ({ isRedirectError: () => false }));
vi.mock('@/lib/auth/guard', () => ({
  requireWorkspace: mocks.requireWorkspace,
  assertCan: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    post: { findFirst: mocks.findFirst, update: mocks.update },
    postPlatform: { updateMany: mocks.updateMany, findMany: vi.fn() },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/posts/service', () => ({
  assertPostNotLive: vi.fn(),
  assertStoredPostValid: vi.fn(),
  deletePost: mocks.deletePost,
  duplicatePost: mocks.duplicatePost,
  savePost: mocks.savePost,
}));
vi.mock('@/lib/queue', () => ({ enqueue: mocks.enqueue }));

import { postCommandAction, updatePostAction } from '@/app/actions/posts';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const postId = '22222222-2222-4222-8222-222222222222';

describe('post server transition enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspace.mockResolvedValue({
      workspace: { id: workspaceId, timezone: 'UTC' },
      user: { id: 'user-1' },
      can: () => true,
    });
  });

  it.each([
    [PostStatus.DRAFT, 'retry'],
    [PostStatus.PENDING_APPROVAL, 'publish'],
    [PostStatus.APPROVED, 'retry'],
    [PostStatus.SCHEDULED, 'restore'],
    [PostStatus.PUBLISHING, 'duplicate'],
    [PostStatus.PUBLISHED, 'publish'],
    [PostStatus.FAILED, 'publish'],
    [PostStatus.CANCELLED, 'reschedule'],
  ] as const)('rejects a forged %s command from %s before mutation', async (status, command) => {
    mocks.findFirst.mockResolvedValue({ id: postId, workspaceId, status });
    const result = await postCommandAction('northwind-studio', postId, command);
    expect(result).toMatchObject({
      status: 'error',
      error: expect.stringContaining('available'),
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.savePost).not.toHaveBeenCalled();
    expect(mocks.deletePost).not.toHaveBeenCalled();
    expect(mocks.duplicatePost).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    [PostStatus.PENDING_APPROVAL, 'publish'],
    [PostStatus.APPROVED, 'approval'],
    [PostStatus.SCHEDULED, 'approval'],
    [PostStatus.PUBLISHING, 'draft'],
    [PostStatus.PUBLISHED, 'publish'],
    [PostStatus.FAILED, 'publish'],
    [PostStatus.CANCELLED, 'draft'],
  ] as const)('rejects forged composer intent %s from %s before save', async (status, intent) => {
    mocks.findFirst.mockResolvedValue({ status });
    const data = new FormData();
    data.set('intent', intent);
    const result = await updatePostAction('northwind-studio', postId, {}, data);
    expect(result).toMatchObject({
      status: 'error',
      error: expect.stringContaining('available'),
    });
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it('rejects an unknown forged composer intent from a draft', async () => {
    mocks.findFirst.mockResolvedValue({ status: PostStatus.DRAFT });
    const data = new FormData();
    data.set('intent', 'force-publish');
    await expect(updatePostAction('northwind-studio', postId, {}, data))
      .resolves.toMatchObject({ status: 'error', error: 'Choose a valid post action.' });
    expect(mocks.savePost).not.toHaveBeenCalled();
  });
});
