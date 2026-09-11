import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireWorkspace: vi.fn(),
  postFindFirst: vi.fn(),
  postUpdate: vi.fn(),
  postUpdateMany: vi.fn(),
  approvalCreate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  notifyWorkspace: vi.fn(),
  notifyRoles: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({
  requireWorkspace: mocks.requireWorkspace,
  requireUser: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    post: {
      findFirst: mocks.postFindFirst,
      update: mocks.postUpdate,
      updateMany: mocks.postUpdateMany,
    },
    approvalComment: { create: mocks.approvalCreate },
    $transaction: mocks.transaction,
    workspaceMember: {},
    workspaceInvite: {},
  },
}));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('@/lib/notifications/service', () => ({
  notifyWorkspace: mocks.notifyWorkspace,
  notifyRoles: mocks.notifyRoles,
}));
vi.mock('@/lib/notifications/email', () => ({ sendInviteEmail: vi.fn() }));
vi.mock('@/lib/crypto/tokens', () => ({ issueSecret: vi.fn(), hashSecret: vi.fn() }));
vi.mock('@/lib/billing/limits', () => ({ assertWithinLimit: vi.fn() }));
vi.mock('@/lib/env', () => ({ publicEnv: { appUrl: 'http://localhost:3000' } }));

import { approvalAction, cancelApprovalRequestAction } from '@/app/actions/team';

describe('approval actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspace.mockResolvedValue({
      workspace: { id: 'workspace-1' },
      user: { id: 'reviewer-1' },
    });
    mocks.postFindFirst.mockResolvedValue({ id: 'post-1' });
    mocks.approvalCreate.mockResolvedValue({ id: 'comment-1' });
    mocks.postUpdate.mockResolvedValue({ id: 'post-1' });
    mocks.transaction.mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations));
    mocks.audit.mockResolvedValue(undefined);
    mocks.notifyWorkspace.mockResolvedValue(undefined);
    mocks.notifyRoles.mockResolvedValue(undefined);
  });

  it.each([
    ['APPROVED', 'approval.approved'],
    ['REJECTED', 'approval.rejected'],
    ['CHANGES_REQUESTED', 'approval.changes_requested'],
  ] as const)('audits %s decisions with workspace, actor, post and comment', async (decision, action) => {
    const formData = new FormData();
    formData.set('body', 'Reviewer context');

    await approvalAction('northwind-studio', 'post-1', decision, formData);

    expect(mocks.requireWorkspace).toHaveBeenCalledWith('northwind-studio', 'post:approve');
    expect(mocks.audit).toHaveBeenNthCalledWith(1, {
      workspaceId: 'workspace-1',
      userId: 'reviewer-1',
      action,
      entityType: 'approval',
      entityId: 'post-1',
      metadata: { decision, comment: 'Reviewer context' },
    });
    expect(mocks.audit).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-1',
      userId: 'reviewer-1',
      action: 'approval.commented',
      entityType: 'approval_comment',
      entityId: 'comment-1',
      metadata: { postId: 'post-1', comment: 'Reviewer context' },
    });
    expect(mocks.notifyWorkspace).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ href: '/w/northwind-studio/posts/post-1' }),
    );
  });

  it.each([
    ['APPROVED', 'APPROVED'],
    ['REJECTED', 'REJECTED'],
    ['CHANGES_REQUESTED', 'DRAFT'],
  ] as const)('moves a %s post to %s', async (decision, status) => {
    await approvalAction('northwind-studio', 'post-1', decision, new FormData());

    expect(mocks.postUpdate).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: { status },
    });
  });

  it('rejects a direct Viewer approval call before reading or mutating the post', async () => {
    mocks.requireWorkspace.mockRejectedValueOnce(new Error('Viewer cannot approve posts.'));

    await expect(
      approvalAction('northwind-studio', 'post-1', 'APPROVED', new FormData()),
    ).rejects.toThrow('Viewer cannot approve posts.');

    expect(mocks.requireWorkspace).toHaveBeenCalledWith('northwind-studio', 'post:approve');
    expect(mocks.postFindFirst).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('rejects a direct Viewer cancellation call before mutating the post', async () => {
    mocks.requireWorkspace.mockRejectedValueOnce(new Error('Viewer cannot edit posts.'));

    const result = await cancelApprovalRequestAction('northwind-studio', 'post-1');

    expect(result.status).toBe('error');
    expect(mocks.requireWorkspace).toHaveBeenCalledWith('northwind-studio', 'post:update');
    expect(mocks.postUpdateMany).not.toHaveBeenCalled();
  });
});
