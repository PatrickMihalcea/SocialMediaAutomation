import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  deleteWorkspace: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    workspace: {
      findUnique: mocks.findUnique,
      delete: mocks.deleteWorkspace,
    },
  },
}));

vi.mock('@/lib/storage', () => ({
  storage: () => ({ delete: mocks.deleteObject }),
}));

import {
  availableWorkspaceSlug,
  deleteWorkspaceWithStorage,
  slugifyWorkspace,
  timezoneChangeNotice,
} from '@/lib/workspaces/lifecycle';

describe('workspace lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes workspace slugs and finds an isolated unique suffix', async () => {
    expect(slugifyWorkspace('  Northwind & Co.  ')).toBe('northwind-co');
    mocks.findUnique
      .mockResolvedValueOnce({ id: 'other-1' })
      .mockResolvedValueOnce({ id: 'other-2' })
      .mockResolvedValueOnce(null);
    await expect(availableWorkspaceSlug('Northwind & Co.')).resolves.toBe('northwind-co-3');
  });

  it('keeps the current workspace slug during safe updates', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'current' });
    await expect(availableWorkspaceSlug('Northwind', 'current')).resolves.toBe('northwind');
  });

  it('explains timezone changes without implying stored publication instants moved', () => {
    expect(timezoneChangeNotice('Europe/Bucharest', 0)).toBe(
      'Calendar and future scheduling now use Eastern European Time (Bucharest).',
    );
    expect(timezoneChangeNotice('Europe/Bucharest', 2)).toBe(
      '2 existing publication instants remain unchanged; calendar times now display in Eastern European Time (Bucharest).',
    );
  });

  it('deletes only storage objects referenced by the selected workspace before its cascade', async () => {
    mocks.findUnique.mockResolvedValue({
      logoStorageKey: 'workspaces/selected/logo.png',
      mediaAssets: [
        { storageKey: 'workspaces/selected/a.jpg', thumbnailKey: 'workspaces/selected/a-thumb.webp' },
        { storageKey: 'workspaces/selected/b.jpg', thumbnailKey: null },
      ],
    });

    await deleteWorkspaceWithStorage('selected');

    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'selected' } }));
    expect(mocks.deleteObject.mock.calls.map(([key]) => key)).toEqual(expect.arrayContaining([
      'workspaces/selected/logo.png',
      'workspaces/selected/a.jpg',
      'workspaces/selected/a-thumb.webp',
      'workspaces/selected/b.jpg',
    ]));
    expect(mocks.deleteWorkspace).toHaveBeenCalledWith({ where: { id: 'selected' } });
  });

  it('does not delete another workspace when the selected workspace is absent', async () => {
    mocks.findUnique.mockResolvedValue(null);
    await deleteWorkspaceWithStorage('missing');
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
  });
});
