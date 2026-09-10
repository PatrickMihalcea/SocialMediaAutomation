import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  aiMediaJob: { findUnique: vi.fn(), update: vi.fn() },
  mediaAsset: { findMany: vi.fn(), create: vi.fn() },
}));
const storageMock = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/env', () => ({ env: { AI_PROVIDER: 'mock' } }));
vi.mock('@/lib/ai', () => ({ aiProvider: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  storage: () => storageMock,
  mediaKey: () => 'workspaces/workspace-1/original/generated.wav',
}));

import { runAiMediaJob } from '@/lib/ai/media-jobs';

describe('AI media worker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores mock audio and completes the durable job', async () => {
    dbMock.aiMediaJob.findUnique.mockResolvedValue({
      id: 'job-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      kind: 'AUDIO_TTS',
      status: 'QUEUED',
      prompt: 'Read this release note',
      inputAssetIds: [],
    });
    dbMock.mediaAsset.findMany.mockResolvedValue([]);
    dbMock.mediaAsset.create.mockResolvedValue({ id: 'asset-1' });
    dbMock.aiMediaJob.update.mockResolvedValue({});

    await runAiMediaJob('job-1');

    expect(storageMock.put).toHaveBeenCalledWith(
      'workspaces/workspace-1/original/generated.wav',
      expect.any(Buffer),
      'audio/wav',
    );
    expect(dbMock.mediaAsset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'AUDIO', status: 'READY' }),
    }));
    expect(dbMock.aiMediaJob.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED', outputAssetId: 'asset-1' }),
    }));
  });
});
