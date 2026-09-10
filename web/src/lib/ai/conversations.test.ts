import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  aiMessage: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  socialAccount: { findMany: vi.fn() },
  post: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/ai', () => ({ generateObject: vi.fn() }));
vi.mock('@/lib/ai/brand-voice', () => ({ buildSystemPrompt: vi.fn() }));

import { confirmProposal } from '@/lib/ai/conversations';

describe('assistant proposal confirmation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is idempotent after a proposal has completed', async () => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      proposalStatus: 'COMPLETED',
      proposal: {
        kind: 'create_drafts',
        summary: 'Create one draft',
        posts: [{ text: 'A durable draft', hashtags: [] }],
      },
    });

    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'OWNER',
      messageId: 'message-1',
    })).resolves.toEqual({ status: 'COMPLETED' });
    expect(dbMock.aiMessage.updateMany).not.toHaveBeenCalled();
    expect(dbMock.post.create).not.toHaveBeenCalled();
  });

  it('does not execute when another request already claimed it', async () => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      createdAt: new Date(),
      proposalStatus: 'PENDING',
      proposal: {
        kind: 'create_drafts',
        summary: 'Create one draft',
        posts: [{ text: 'A durable draft', hashtags: [] }],
      },
    });
    dbMock.aiMessage.updateMany.mockResolvedValue({ count: 0 });
    dbMock.aiMessage.findUnique.mockResolvedValue({ proposalStatus: 'EXECUTING' });

    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'OWNER',
      messageId: 'message-1',
    })).resolves.toEqual({ status: 'EXECUTING' });
    expect(dbMock.post.create).not.toHaveBeenCalled();
  });

  it('rejects an expired proposal before claiming it', async () => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      createdAt: new Date(Date.now() - 31 * 60 * 1000),
      proposalStatus: 'PENDING',
      proposal: {
        kind: 'create_drafts',
        summary: 'Create one draft',
        posts: [{ text: 'A durable draft', hashtags: [] }],
      },
    });

    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'OWNER',
      messageId: 'message-1',
    })).rejects.toThrow('This proposal expired');
    expect(dbMock.aiMessage.updateMany).not.toHaveBeenCalled();
  });

  it('enforces current permissions before claiming a proposal', async () => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      createdAt: new Date(),
      proposalStatus: 'PENDING',
      proposal: {
        kind: 'schedule_posts',
        summary: 'Schedule one post',
        postIds: ['post-1'],
        weekdays: [5],
        hour: 10,
        minute: 0,
      },
    });

    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'VIEWER',
      messageId: 'message-1',
    })).rejects.toThrow('Your current role cannot confirm this proposal');
    expect(dbMock.aiMessage.updateMany).not.toHaveBeenCalled();
    expect(dbMock.post.update).not.toHaveBeenCalled();
  });

  it.each(['PUBLISHED', 'PUBLISHING'] as const)('never re-dates a %s post', async (status) => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      createdAt: new Date(),
      proposalStatus: 'PENDING',
      proposal: {
        kind: 'schedule_posts',
        summary: 'Move one post',
        postIds: ['post-1'],
        weekdays: [5],
        hour: 10,
        minute: 0,
      },
    });
    dbMock.aiMessage.updateMany.mockResolvedValue({ count: 1 });
    dbMock.post.findMany.mockResolvedValue([{ id: 'post-1', status }]);

    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'EDITOR',
      messageId: 'message-1',
    })).rejects.toThrow(status === 'PUBLISHED' ? 'already been published' : 'publishing right now');
    expect(dbMock.post.update).not.toHaveBeenCalled();
    expect(dbMock.aiMessage.update).toHaveBeenCalledWith({
      where: { id: 'message-1' },
      data: { proposalStatus: 'PENDING' },
    });
  });
});
