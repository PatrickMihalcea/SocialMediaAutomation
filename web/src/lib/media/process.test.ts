import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaStatus, MediaType } from '@prisma/client';

const dbMock = vi.hoisted(() => ({
  mediaAsset: {
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
  },
}));
const storageMock = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));
const mediaKeyMock = vi.hoisted(() => vi.fn(() => 'workspaces/ws/derived/new.jpg'));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/storage', () => ({ storage: () => storageMock, mediaKey: mediaKeyMock }));
vi.mock('@/lib/notifications/service', () => ({ notify: vi.fn() }));
vi.mock('@/lib/queue/runner', () => ({ PermanentJobError: class PermanentJobError extends Error {} }));
vi.mock('sharp', () => {
  const metadata = vi.fn(async () => ({ width: 1080, height: 1080 }));
  const pipeline = {
    rotate: vi.fn(() => pipeline),
    extract: vi.fn(() => pipeline),
    resize: vi.fn(() => pipeline),
    jpeg: vi.fn(() => pipeline),
    toBuffer: vi.fn(async () => Buffer.from('derivative')),
    metadata,
  };
  return { default: vi.fn(() => pipeline) };
});

import { createImageDerivative } from '@/lib/media/process';

describe('media derivative lineage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.get.mockResolvedValue(Buffer.from('original'));
    dbMock.mediaAsset.findUniqueOrThrow.mockResolvedValue({
      id: 'source-1',
      workspaceId: 'workspace-1',
      folderId: 'folder-1',
      uploadedById: 'user-1',
      filename: 'original.png',
      storageKey: 'workspaces/ws/original/source.png',
      altText: 'Product photo',
      type: MediaType.IMAGE,
    });
    dbMock.mediaAsset.create.mockResolvedValue({ id: 'derivative-1' });
  });

  it('creates a new processing asset linked to its source', async () => {
    await expect(createImageDerivative({
      sourceAssetId: 'source-1',
      presetId: 'ig-square',
      presetLabel: 'Instagram square',
      resize: { width: 1080, height: 1080 },
    })).resolves.toBe('derivative-1');

    expect(storageMock.put).toHaveBeenCalledWith(
      'workspaces/ws/derived/new.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
    expect(dbMock.mediaAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        derivedFromId: 'source-1',
        derivationPreset: 'Instagram square',
        storageKey: 'workspaces/ws/derived/new.jpg',
        status: MediaStatus.PROCESSING,
      }),
    });
    expect(storageMock.put.mock.calls[0]?.[0]).not.toBe('workspaces/ws/original/source.png');
  });
});
