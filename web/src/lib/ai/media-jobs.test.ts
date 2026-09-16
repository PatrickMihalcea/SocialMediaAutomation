import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  aiMediaJob: { findUnique: vi.fn(), update: vi.fn() },
  aiGeneration: { create: vi.fn() },
  mediaAsset: { findMany: vi.fn(), create: vi.fn() },
}));
const storageMock = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/env', () => ({ env: { AI_PROVIDER: 'mock', AI_IMAGE_PROVIDER: 'inherit' } }));
vi.mock('@/lib/ai', () => ({ imageProvider: vi.fn() }));
vi.mock('@/lib/billing/limits', () => ({ incrementUsage: vi.fn() }));
vi.mock('@/lib/notifications/service', () => ({ notify: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  storage: () => storageMock,
  mediaKey: () => 'workspaces/workspace-1/original/generated.wav',
}));

import { mediaProviderDescriptor, runAiMediaJob } from '@/lib/ai/media-jobs';

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
      provider: 'mock',
      model: 'mock-audio-1',
      estimatedCost: null,
      workspace: { slug: 'northwind-studio' },
    });
    dbMock.mediaAsset.findMany.mockResolvedValue([]);
    dbMock.aiGeneration.create.mockResolvedValue({ id: 'generation-1' });
    dbMock.mediaAsset.create.mockResolvedValue({ id: 'asset-1' });
    dbMock.aiMediaJob.update.mockResolvedValue({});

    await runAiMediaJob('job-1');

    expect(storageMock.put).toHaveBeenCalledWith(
      'workspaces/workspace-1/original/generated.wav',
      expect.any(Buffer),
      'audio/wav',
    );
    expect(dbMock.mediaAsset.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'AUDIO',
        status: 'READY',
        aiGenerationId: 'generation-1',
      }),
    }));
    expect(dbMock.aiMediaJob.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED', outputAssetId: 'asset-1' }),
    }));
  });

  it('does not persist provider output after cancellation', async () => {
    dbMock.aiMediaJob.findUnique
      .mockResolvedValueOnce({
        id: 'job-2',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        kind: 'AUDIO_TTS',
        status: 'QUEUED',
        prompt: 'Cancel this narration',
        inputAssetIds: [],
        provider: 'mock',
        model: 'mock-audio-1',
        estimatedCost: null,
        workspace: { slug: 'northwind-studio' },
      })
      .mockResolvedValueOnce({ status: 'CANCELLED' });
    dbMock.mediaAsset.findMany.mockResolvedValue([]);
    dbMock.aiMediaJob.update.mockResolvedValue({});

    await runAiMediaJob('job-2');

    expect(storageMock.put).not.toHaveBeenCalled();
    expect(dbMock.mediaAsset.create).not.toHaveBeenCalled();
    expect(dbMock.aiGeneration.create).not.toHaveBeenCalled();
  });
});

describe('mediaProviderDescriptor', () => {
  it('allows a workflow step to force a mock media provider', () => {
    expect(mediaProviderDescriptor('VIDEO_ANIMATE', true)).toEqual({
      provider: 'mock',
      model: 'mock-video-1',
    });
  });
});
