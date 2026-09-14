import 'server-only';
import { MediaStatus, MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { PermanentJobError } from '@/lib/queue/runner';
import { humanizeMachineValue } from '@/bridge88/humanize';
import type { NodeRunContext } from '@/lib/workflows/node-context';

interface Config {
  folderId: string | null;
  assetId: string | null;
  includeSubfolders: boolean;
}

const MAX_ASSETS = 1000;

/**
 * Loads stable lists of existing library assets. Selection and ordering stay in
 * downstream utility steps, so one source can be reused by different branches.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const folderIds = !config.assetId && config.folderId
    ? await selectedFolderIds(ctx.workspaceId, config.folderId, config.includeSubfolders)
    : null;

  const assets = await db.mediaAsset.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      status: MediaStatus.READY,
      type: { in: [MediaType.IMAGE, MediaType.VIDEO, MediaType.AUDIO] },
      ...(config.assetId ? { id: config.assetId } : {}),
      ...(!config.assetId && folderIds ? { folderId: { in: folderIds } } : {}),
    },
    select: { id: true, type: true, filename: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_ASSETS + 1,
  });

  if (assets.length > MAX_ASSETS) {
    throw new PermanentJobError(
      `This source contains more than ${MAX_ASSETS} ready media items. Choose a smaller folder.`,
    );
  }
  if (config.assetId && assets.length === 0) {
    throw new PermanentJobError('That media item is no longer available.');
  }

  const images = assets.filter((asset) => asset.type === MediaType.IMAGE);

  return {
    images: images.map((asset) => asset.id),
    videos: assets.filter((asset) => asset.type === MediaType.VIDEO).map((asset) => asset.id),
    audio: assets.filter((asset) => asset.type === MediaType.AUDIO).map((asset) => asset.id),
    // Aligned position by position with `images`, which is what lets a label
    // reach the right clip. Anything that reorders the ids has to reorder these
    // with them — Select items does, by applying one set of positions to both.
    //
    // Humanised with the same function the media library renders names through,
    // so a label burnt onto a video reads as the file the user recognises rather
    // than as "oak-loft-bedroom-1789357101163.png".
    imageTitles: images.map((asset) => humanizeMachineValue(asset.filename)),
  };
}

async function selectedFolderIds(
  workspaceId: string,
  selectedId: string,
  includeSubfolders: boolean,
): Promise<string[]> {
  const folders = await db.mediaFolder.findMany({
    where: { workspaceId },
    select: { id: true, parentId: true },
  });
  if (!folders.some((folder) => folder.id === selectedId)) {
    throw new PermanentJobError('That media folder no longer exists.');
  }
  if (!includeSubfolders) return [selectedId];

  const selected = new Set([selectedId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && selected.has(folder.parentId) && !selected.has(folder.id)) {
        selected.add(folder.id);
        changed = true;
      }
    }
  }
  return [...selected];
}
