import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  aiMessage: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
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
});
