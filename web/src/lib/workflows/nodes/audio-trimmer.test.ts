import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  storageGet: vi.fn(),
  storagePut: vi.fn(),
  renderAudioTrim: vi.fn(),
  renderVideoEdit: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { mediaAsset: { findFirst: mocks.findFirst, create: mocks.create } },
}));
vi.mock('@/lib/storage', () => ({
  mediaKey: vi.fn(() => 'derived/key'),
  storage: () => ({ get: mocks.storageGet, put: mocks.storagePut }),
}));
vi.mock('@/lib/media/process', () => ({ hasFfmpeg: vi.fn(async () => true) }));
vi.mock('@/lib/media/ffmpeg-edit', () => ({
  renderAudioTrim: mocks.renderAudioTrim,
  renderVideoEdit: mocks.renderVideoEdit,
}));
vi.mock('@/lib/queue', () => ({ enqueue: mocks.enqueue }));

import { run } from '@/lib/workflows/nodes/audio-trimmer';
import type { NodeRunContext } from '@/lib/workflows/node-context';

function context(config: Record<string, unknown>): NodeRunContext {
  return {
    workspaceId: 'workspace-1',
    runId: 'run-1',
    nodeRunId: 'node-run-1',
    nodeId: 'node-1',
    nodeName: 'Trim',
    workflowName: 'Workflow',
    userId: 'user-1',
    attempt: 1,
    config,
    inputs: { audio: 'asset-1' },
    previousOutput: null,
    assertNotCancelled: vi.fn(),
    heartbeat: vi.fn(),
    saveProgress: vi.fn(),
    emitAssets: vi.fn(),
  };
}

const base = {
  id: 'asset-1',
  workspaceId: 'workspace-1',
  filename: 'source.mp4',
  storageKey: 'source/key',
  duration: 10,
  width: 1920,
  height: 1080,
  beatGrid: [],
  downbeats: [],
  beatStrength: [],
  bpm: null,
  beatsPerBar: null,
  beatAnalyzer: null,
  beatGridVersion: null,
};

describe('Trimmer workflow node', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storageGet.mockResolvedValue(Buffer.from('source'));
    mocks.storagePut.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue({ id: 'trimmed-1' });
    mocks.renderAudioTrim.mockResolvedValue(Buffer.from('audio'));
    mocks.renderVideoEdit.mockResolvedValue(Buffer.from('video'));
  });

  it('trims a video and queues poster processing', async () => {
    mocks.findFirst.mockResolvedValue({ ...base, type: 'VIDEO', mimeType: 'video/mp4' });
    const ctx = context({
      mode: 'range',
      startSeconds: 2,
      endSeconds: 7,
      bars: 8,
      snapToDownbeat: true,
    });

    await expect(run(ctx)).resolves.toMatchObject({
      audio: 'trimmed-1',
      startSeconds: 2,
      endSeconds: 7,
    });
    expect(mocks.renderVideoEdit).toHaveBeenCalledWith(
      Buffer.from('source'),
      'source.mp4',
      { startSeconds: 2, endSeconds: 7 },
    );
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'VIDEO', duration: 5, status: 'READY' }),
    }));
    expect(mocks.enqueue).toHaveBeenCalled();
  });

  it('trims audio with sample-accurate range filtering', async () => {
    mocks.findFirst.mockResolvedValue({
      ...base,
      type: 'AUDIO',
      mimeType: 'audio/mpeg',
      filename: 'track.mp3',
      beatGrid: [1, 2, 3, 4],
      downbeats: [1, 3],
      beatStrength: [0.1, 0.2, 0.3, 0.4],
      bpm: 120,
    });
    await run(context({
      mode: 'range',
      startSeconds: 2,
      endSeconds: 4,
      bars: 8,
      snapToDownbeat: true,
    }));
    expect(mocks.renderAudioTrim).toHaveBeenCalledWith(Buffer.from('source'), 2, 4);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'AUDIO',
        beatGrid: [0, 1, 2],
        downbeats: [1],
      }),
    }));
  });

  it('rejects a range outside the source duration', async () => {
    mocks.findFirst.mockResolvedValue({ ...base, type: 'VIDEO', mimeType: 'video/mp4' });
    await expect(run(context({
      mode: 'range',
      startSeconds: 2,
      endSeconds: 12,
      bars: 8,
      snapToDownbeat: true,
    }))).rejects.toThrow('beyond the media duration');
    expect(mocks.renderVideoEdit).not.toHaveBeenCalled();
  });
});
