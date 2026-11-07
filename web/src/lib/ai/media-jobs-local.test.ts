import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({ aiMediaJob: { create: vi.fn() } }));
const enqueue = vi.hoisted(() => vi.fn());

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/env', () => ({
  env: { AI_PROVIDER: 'mock', AI_IMAGE_PROVIDER: 'inherit', OPENAI_IMAGE_MODEL: 'gpt-image-1' },
}));
vi.mock('@/lib/ai', () => ({ imageProvider: vi.fn() }));
vi.mock('@/lib/billing/limits', () => ({
  assertWithinLimit: vi.fn(),
  currentMonthUsage: vi.fn().mockResolvedValue(0),
  incrementUsage: vi.fn(),
}));
vi.mock('@/lib/notifications/service', () => ({ notify: vi.fn() }));
vi.mock('@/lib/storage', () => ({ storage: vi.fn(), mediaKey: vi.fn() }));
vi.mock('@/lib/queue', () => ({ enqueue }));

import { createAiMediaJob, mediaProviderDescriptor } from '@/lib/ai/media-jobs';

const base = { workspaceId: 'w', userId: 'u', prompt: 'a clip' };

describe('ComfyUI media jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.aiMediaJob.create.mockImplementation(({ data }) => Promise.resolve({
      id: 'job-1', kind: data.kind, status: 'QUEUED', provider: data.provider,
    }));
  });

  it('keeps ComfyUI for edits and video, which it has workflows for', () => {
    expect(mediaProviderDescriptor('VIDEO_ANIMATE', 'comfyui')).toEqual({ provider: 'comfyui', model: 'comfyui' });
    expect(mediaProviderDescriptor('IMAGE_EDIT', 'comfyui')).toEqual({ provider: 'comfyui', model: 'comfyui' });
  });

  it('queues ComfyUI work where only the local worker will take it', async () => {
    await createAiMediaJob({ ...base, kind: 'VIDEO_GENERATE', provider: 'comfyui' });
    expect(enqueue).toHaveBeenCalledWith('ai-media-job', { aiMediaJobId: 'job-1' }, expect.objectContaining({ queue: 'LOCAL_GENERATION' }));
  });

  it('leaves everything else on its usual queue', async () => {
    await createAiMediaJob({ ...base, kind: 'VIDEO_GENERATE' });
    expect(enqueue.mock.calls[0][2]).not.toHaveProperty('queue');
  });

  it('records the clip length and motion with the job, so the worker renders what was asked', async () => {
    await createAiMediaJob({ ...base, kind: 'VIDEO_ANIMATE', provider: 'comfyui', seconds: 6, motion: 'subtle' });
    expect(dbMock.aiMediaJob.create.mock.calls[0][0].data.metadata).toEqual({ seconds: 6, motion: 'subtle' });
  });

  /** Queued as well as run inline, the same clip rendered twice at once. */
  it('queues nothing for a job its caller runs itself', async () => {
    await createAiMediaJob({ ...base, kind: 'VIDEO_ANIMATE', provider: 'comfyui', inline: true });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
