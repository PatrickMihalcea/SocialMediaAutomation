import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  mediaFolder: { findMany: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import { run } from '@/lib/workflows/nodes/media-library';
import type { NodeRunContext } from '@/lib/workflows/node-context';

function context(config: Record<string, unknown>): NodeRunContext {
  return {
    workspaceId: 'workspace-1',
    runId: 'run-1',
    nodeRunId: 'node-run-1',
    nodeId: 'node-1',
    nodeName: 'Library',
    workflowName: 'Workflow',
    userId: null,
    attempt: 1,
    config,
    inputs: {},
    previousOutput: null,
    assertNotCancelled: vi.fn(),
    heartbeat: vi.fn(),
    saveProgress: vi.fn(),
    emitAssets: vi.fn(),
  };
}

describe('media library workflow source', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads a selected folder and its descendants, grouped by media kind', async () => {
    dbMock.mediaFolder.findMany.mockResolvedValue([
      { id: 'parent', parentId: null },
      { id: 'child', parentId: 'parent' },
      { id: 'elsewhere', parentId: null },
    ]);
    dbMock.mediaAsset.findMany.mockResolvedValue([
      { id: 'image-1', type: 'IMAGE', filename: 'oak-loft-bedroom.png' },
      { id: 'video-1', type: 'VIDEO', filename: 'clip.mp4' },
      { id: 'audio-1', type: 'AUDIO', filename: 'track.mp3' },
    ]);

    await expect(run(context({ folderId: 'parent', includeSubfolders: true }))).resolves.toEqual({
      images: ['image-1'],
      videos: ['video-1'],
      audio: ['audio-1'],
      imageTitles: ['Oak loft bedroom'],
    });
    expect(dbMock.mediaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ folderId: { in: expect.arrayContaining(['parent', 'child']) } }),
      }),
    );
  });

  // The titles are what a text overlay burns onto each cut, so they have to
  // arrive in the same order as the ids and read like the library, not the disk.
  it('names each image in the same order as the ids, tidied for display', async () => {
    dbMock.mediaFolder.findMany.mockResolvedValue([]);
    dbMock.mediaAsset.findMany.mockResolvedValue([
      { id: 'image-1', type: 'IMAGE', filename: 'the-attic-suite.jpg' },
      { id: 'audio-1', type: 'AUDIO', filename: 'track.mp3' },
      { id: 'image-2', type: 'IMAGE', filename: 'garden_room-1789357101163.png' },
    ]);

    const output = await run(context({ folderId: null, includeSubfolders: true }));

    expect(output.images).toEqual(['image-1', 'image-2']);
    // Non-image assets sit between them in the query, and must not shift the
    // titles off their images.
    expect(output.imageTitles).toEqual(['The attic suite', 'Garden room']);
  });

  it('rejects a folder that is no longer in the workspace', async () => {
    dbMock.mediaFolder.findMany.mockResolvedValue([]);
    await expect(run(context({ folderId: 'missing', includeSubfolders: true })))
      .rejects.toThrow('no longer exists');
    expect(dbMock.mediaAsset.findMany).not.toHaveBeenCalled();
  });

  it('can load one specific ready media item without reading its folder', async () => {
    dbMock.mediaAsset.findMany.mockResolvedValue([
      { id: 'video-1', type: 'VIDEO', filename: 'chosen-clip.mp4' },
    ]);

    await expect(run(context({
      assetId: 'video-1',
      folderId: 'stale-folder',
      includeSubfolders: true,
    }))).resolves.toEqual({
      images: [],
      videos: ['video-1'],
      audio: [],
      imageTitles: [],
    });
    expect(dbMock.mediaFolder.findMany).not.toHaveBeenCalled();
    expect(dbMock.mediaAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'video-1', workspaceId: 'workspace-1' }),
    }));
  });
});
