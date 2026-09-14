import type {
  WorkflowMediaCounts,
  WorkflowMediaAssetOption,
  WorkflowMediaFolderOption,
} from '@/lib/workflows/definitions';

export type MediaLibraryOutputCounts = {
  images: number;
  videos: number;
  audio: number;
  imageTitles: number;
};

/** Counts the output ports currently backed by ready media in the selected folder. */
export function mediaLibraryOutputCounts(
  rawConfig: unknown,
  folders: WorkflowMediaFolderOption[],
  wholeLibrary: WorkflowMediaCounts,
  assets: WorkflowMediaAssetOption[] = [],
): MediaLibraryOutputCounts {
  const config = (rawConfig ?? {}) as {
    folderId?: unknown;
    assetId?: unknown;
    includeSubfolders?: unknown;
  };
  if (typeof config.assetId === 'string') {
    const selected = assets.find((asset) => asset.id === config.assetId);
    if (!selected) return withTitles({ images: 0, videos: 0, audio: 0 });
    return withTitles({
      images: selected.type === 'IMAGE' ? 1 : 0,
      videos: selected.type === 'VIDEO' ? 1 : 0,
      audio: selected.type === 'AUDIO' ? 1 : 0,
    });
  }
  if (typeof config.folderId !== 'string') return withTitles(wholeLibrary);

  const selected = folders.find((folder) => folder.id === config.folderId);
  if (!selected) return withTitles({ images: 0, videos: 0, audio: 0 });
  if (config.includeSubfolders === false) return withTitles(selected.counts);

  const selectedIds = new Set([selected.id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && selectedIds.has(folder.parentId) && !selectedIds.has(folder.id)) {
        selectedIds.add(folder.id);
        changed = true;
      }
    }
  }

  const counts = { images: 0, videos: 0, audio: 0 };
  for (const folder of folders) {
    if (!selectedIds.has(folder.id)) continue;
    counts.images += folder.counts.images;
    counts.videos += folder.counts.videos;
    counts.audio += folder.counts.audio;
  }
  return withTitles(counts);
}

function withTitles(counts: WorkflowMediaCounts): MediaLibraryOutputCounts {
  return { ...counts, imageTitles: counts.images };
}
