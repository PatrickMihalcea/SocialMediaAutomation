import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tagFindFirst: vi.fn(),
  tagUpsert: vi.fn(),
  assetFindMany: vi.fn(),
  linkCreateMany: vi.fn(),
  linkDeleteMany: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({
  requireWorkspace: vi.fn().mockResolvedValue({
    workspace: { id: '11111111-1111-4111-8111-111111111111' },
    user: { id: '22222222-2222-4222-8222-222222222222' },
  }),
}));
vi.mock('@/lib/storage', () => ({ mediaKey: vi.fn(), storage: () => ({}) }));
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn() }));
vi.mock('@/lib/media/process', () => ({
  createImageDerivative: vi.fn(),
  createVideoDerivative: vi.fn(),
}));
vi.mock('@/lib/media/upload', () => ({ storeMediaUpload: vi.fn() }));
vi.mock('@/lib/db', () => ({
  db: {
    mediaTag: { findFirst: mocks.tagFindFirst, upsert: mocks.tagUpsert },
    mediaAsset: { findMany: mocks.assetFindMany },
    mediaAssetTag: { createMany: mocks.linkCreateMany, deleteMany: mocks.linkDeleteMany },
  },
}));

import { applyTagAction, createTagAction } from '@/app/actions/media';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

const TAG = { id: '33333333-3333-4333-8333-333333333333', name: 'Treehouses' };
const ASSETS = ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];

describe('applyTagAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tagFindFirst.mockResolvedValue(TAG);
    mocks.assetFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id })));
  });

  it('adds the tag to every asset without duplicating an existing link', async () => {
    const result = await applyTagAction('northwind-studio', {
      assetIds: ASSETS,
      tagId: TAG.id,
      apply: true,
    });

    expect(mocks.linkCreateMany).toHaveBeenCalledWith({
      data: ASSETS.map((mediaAssetId) => ({ mediaAssetId, mediaTagId: TAG.id })),
      skipDuplicates: true,
    });
    expect(result.message).toBe('Treehouses added to 2 assets.');
  });

  it('removes the tag when apply is false', async () => {
    await applyTagAction('northwind-studio', { assetIds: [ASSETS[0]], tagId: TAG.id, apply: false });

    expect(mocks.linkCreateMany).not.toHaveBeenCalled();
    expect(mocks.linkDeleteMany).toHaveBeenCalledWith({
      where: { mediaAssetId: { in: [ASSETS[0]] }, mediaTagId: TAG.id },
    });
  });

  // The picker sends ids straight from the client, so the workspace scope has
  // to be enforced here rather than trusted from the selection.
  it('writes nothing when an asset belongs to another workspace', async () => {
    mocks.assetFindMany.mockResolvedValue([{ id: ASSETS[0] }]);

    await expect(applyTagAction('northwind-studio', {
      assetIds: ASSETS,
      tagId: TAG.id,
      apply: true,
    })).rejects.toThrow(/unavailable/i);
    expect(mocks.linkCreateMany).not.toHaveBeenCalled();
  });

  it('refuses a tag from another workspace', async () => {
    mocks.tagFindFirst.mockResolvedValue(null);

    await expect(applyTagAction('northwind-studio', {
      assetIds: ASSETS,
      tagId: TAG.id,
      apply: true,
    })).rejects.toThrow('Tag not found.');
    expect(mocks.linkCreateMany).not.toHaveBeenCalled();
  });
});

describe('createTagAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tagUpsert.mockResolvedValue(TAG);
  });

  // "Create and apply" is one gesture, so retyping a name that already exists
  // has to resolve to that tag instead of failing the unique constraint.
  it('returns the existing tag rather than failing on a repeated name', async () => {
    const result = await createTagAction('northwind-studio', formWith('Treehouses'));

    expect(mocks.tagUpsert).toHaveBeenCalledWith({
      where: { workspaceId_name: { workspaceId: WORKSPACE, name: 'Treehouses' } },
      update: {},
      create: { workspaceId: WORKSPACE, name: 'Treehouses' },
    });
    expect(result).toEqual(TAG);
  });

  it('rejects a blank name', async () => {
    await expect(createTagAction('northwind-studio', formWith('   '))).rejects.toThrow(/tag name/i);
    expect(mocks.tagUpsert).not.toHaveBeenCalled();
  });
});

function formWith(name: string) {
  const form = new FormData();
  form.set('name', name);
  return form;
}
