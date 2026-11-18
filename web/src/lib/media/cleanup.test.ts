import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  workflowNode: { findMany: vi.fn() },
  mediaAsset: { findMany: vi.fn(), delete: vi.fn() },
}));
const storageMock = vi.hoisted(() => ({ delete: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/storage', () => ({ storage: () => storageMock }));

import { deleteOldRunFiles } from '@/lib/media/cleanup';

const asset = (id: string, extra: Record<string, unknown> = {}) => ({ id, size: 1000, storageKey: `k/${id}`, thumbnailKey: null, ...extra });

describe('deleteOldRunFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.mediaAsset.delete.mockResolvedValue({});
    storageMock.delete.mockResolvedValue(undefined);
  });

  it('deletes the file and its row, but keeps anything a step setting points at', async () => {
    dbMock.workflowNode.findMany.mockResolvedValue([{ config: { styleImage: 'b-style' } }]);
    dbMock.mediaAsset.findMany
      .mockResolvedValueOnce([asset('a-old', { thumbnailKey: 't/a' }), asset('b-style')])
      .mockResolvedValueOnce([]);

    const result = await deleteOldRunFiles(new Date('2026-11-18T00:00:00Z'));

    expect(result).toEqual({ deleted: 1, bytes: 1000 });
    expect(storageMock.delete).toHaveBeenCalledWith('k/a-old');
    expect(storageMock.delete).toHaveBeenCalledWith('t/a');
    expect(dbMock.mediaAsset.delete).toHaveBeenCalledWith({ where: { id: 'a-old' } });
    expect(storageMock.delete).not.toHaveBeenCalledWith('k/b-style');
  });

  it('only looks at files older than a week that no post uses', async () => {
    dbMock.workflowNode.findMany.mockResolvedValue([]);
    dbMock.mediaAsset.findMany.mockResolvedValueOnce([]);

    await deleteOldRunFiles(new Date('2026-11-18T00:00:00Z'));

    const { where } = dbMock.mediaAsset.findMany.mock.calls[0][0];
    expect(where.createdAt).toEqual({ lt: new Date('2026-11-11T00:00:00Z') });
    expect(where.postMedia).toEqual({ none: {} });
    expect(where.folderId).toBeNull();
  });

  it('keeps the row when its file could not be deleted', async () => {
    dbMock.workflowNode.findMany.mockResolvedValue([]);
    dbMock.mediaAsset.findMany.mockResolvedValueOnce([asset('c')]).mockResolvedValueOnce([]);
    storageMock.delete.mockRejectedValueOnce(new Error('offline'));

    const result = await deleteOldRunFiles();

    expect(result.deleted).toBe(0);
    expect(dbMock.mediaAsset.delete).not.toHaveBeenCalled();
  });
});
