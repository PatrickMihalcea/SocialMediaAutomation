import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  aiMediaJob: { findUnique: vi.fn(), update: vi.fn() },
  aiGeneration: { create: vi.fn() },
  mediaAsset: { findMany: vi.fn(), create: vi.fn() },
}));
const storageMock = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/env', () => ({
  env: { AI_PROVIDER: 'mock', AI_IMAGE_PROVIDER: 'inherit', OPENAI_IMAGE_MODEL: 'gpt-image-1' },
}));
vi.mock('@/lib/ai', () => ({ imageProvider: vi.fn() }));
vi.mock('@/lib/billing/limits', () => ({ incrementUsage: vi.fn() }));
vi.mock('@/lib/notifications/service', () => ({ notify: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  storage: () => storageMock,
  mediaKey: () => 'workspaces/workspace-1/original/generated.wav',
}));

import { mediaProviderDescriptor, runAiMediaJob } from '@/lib/ai/media-jobs';
import { env } from '@/lib/env';

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
  beforeEach(() => {
    env.AI_PROVIDER = 'mock';
    env.AI_IMAGE_PROVIDER = 'inherit';
  });

  it('allows a workflow step to force a mock media provider', () => {
    expect(mediaProviderDescriptor('VIDEO_ANIMATE', 'mock')).toEqual({
      provider: 'mock',
      model: 'mock-video-1',
    });
  });

  /**
   * The failure this prevents: image-use is neither 'openai' nor 'mock', so a
   * descriptor that only knows those two labels the job 'mock' and the runner
   * then quietly produces a placeholder instead of a real image.
   */
  it('routes a queued generation to image-use when that is the image provider', () => {
    env.AI_IMAGE_PROVIDER = 'image-use';

    expect(mediaProviderDescriptor('IMAGE_GENERATE')).toEqual({
      provider: 'image-use',
      model: 'image-use',
    });
  });

  it('keeps edits on the provider that can actually edit an image', () => {
    env.AI_PROVIDER = 'openai';
    env.AI_IMAGE_PROVIDER = 'image-use';

    // image-use renders from a prompt only, so an edit must not land on it.
    expect(mediaProviderDescriptor('IMAGE_EDIT')).toEqual({
      provider: 'openai',
      model: 'gpt-image-1',
    });
  });
});
