import { describe, expect, it } from 'vitest';
import { mediaLibraryOutputCounts } from '@/lib/workflows/media-library-outputs';

const folders = [
  {
    id: 'parent',
    name: 'Campaign',
    parentId: null,
    counts: { images: 2, videos: 0, audio: 1 },
  },
  {
    id: 'child',
    name: 'Exports',
    parentId: 'parent',
    counts: { images: 0, videos: 3, audio: 0 },
  },
  {
    id: 'other',
    name: 'Other',
    parentId: null,
    counts: { images: 7, videos: 7, audio: 7 },
  },
];

describe('mediaLibraryOutputCounts', () => {
  it('uses whole-library counts when no folder is selected', () => {
    expect(mediaLibraryOutputCounts(
      { folderId: null, includeSubfolders: true },
      folders,
      { images: 9, videos: 10, audio: 8 },
    )).toEqual({ images: 9, imageTitles: 9, videos: 10, audio: 8 });
  });

  it('changes outputs with the selected folder and nested-folder setting', () => {
    expect(mediaLibraryOutputCounts(
      { folderId: 'parent', includeSubfolders: false },
      folders,
      { images: 9, videos: 10, audio: 8 },
    )).toEqual({ images: 2, imageTitles: 2, videos: 0, audio: 1 });

    expect(mediaLibraryOutputCounts(
      { folderId: 'parent', includeSubfolders: true },
      folders,
      { images: 9, videos: 10, audio: 8 },
    )).toEqual({ images: 2, imageTitles: 2, videos: 3, audio: 1 });
  });

  it('shows no backed outputs for a deleted folder', () => {
    expect(mediaLibraryOutputCounts(
      { folderId: 'missing', includeSubfolders: true },
      folders,
      { images: 9, videos: 10, audio: 8 },
    )).toEqual({ images: 0, imageTitles: 0, videos: 0, audio: 0 });
  });

  it('shows only the output belonging to a specifically selected item', () => {
    expect(mediaLibraryOutputCounts(
      { assetId: 'clip', folderId: null, includeSubfolders: true },
      folders,
      { images: 9, videos: 10, audio: 8 },
      [{ id: 'clip', filename: 'Intro.mp4', folderId: null, type: 'VIDEO' }],
    )).toEqual({ images: 0, imageTitles: 0, videos: 1, audio: 0 });
  });
});
