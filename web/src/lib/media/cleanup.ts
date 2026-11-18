import 'server-only';
import { MediaType, WorkflowRunStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';

/** How long a step's leftover files stay, so a recent run can still be replayed. */
export const KEEP_RUN_FILES_DAYS = 7;
const BATCH = 200;

/**
 * Deletes the pictures and clips workflow steps made along the way once they
 * are a week old.
 *
 * Every run leaves its in-between files behind — the pictures before they were
 * animated, the slideshow before its text went on — and they are most of what
 * the bucket holds. Only the finished post matters after a week, and the free
 * storage tier is 10 GB.
 *
 * Kept: anything in a post, anything filed in a folder, anything a step's
 * settings point at (a style image, a theme's layout), anything not made by a
 * workflow, and anything from a run that has not finished.
 */
export async function deleteOldRunFiles(now = new Date()): Promise<{ deleted: number; bytes: number }> {
  const cutoff = new Date(now.getTime() - KEEP_RUN_FILES_DAYS * 24 * 60 * 60 * 1000);
  // Settings hold asset ids in many shapes, so they are searched as text.
  const settings = (await db.workflowNode.findMany({ select: { config: true } }))
    .map((node) => JSON.stringify(node.config))
    .join(' ');

  let deleted = 0;
  let bytes = 0;
  let after: string | undefined;
  for (;;) {
    const assets = await db.mediaAsset.findMany({
      where: {
        type: { in: [MediaType.IMAGE, MediaType.VIDEO] },
        folderId: null,
        createdAt: { lt: cutoff },
        postMedia: { none: {} },
        soundtrackFor: { none: {} },
        workflowOutputs: { some: {} },
        NOT: {
          workflowOutputs: {
            some: { nodeRun: { run: { status: { in: [WorkflowRunStatus.QUEUED, WorkflowRunStatus.RUNNING] } } } },
          },
        },
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: { id: true, size: true, storageKey: true, thumbnailKey: true },
    });
    if (assets.length === 0) break;
    after = assets[assets.length - 1].id;

    const doomed = assets.filter((asset) => !settings.includes(asset.id));
    for (const asset of doomed) {
      try {
        await storage().delete(asset.storageKey);
        if (asset.thumbnailKey) await storage().delete(asset.thumbnailKey);
      } catch (error) {
        // Left for the next pass rather than leaving a row with no file.
        console.warn('[cleanup] could not delete a file; trying again next time', asset.id, error);
        continue;
      }
      await db.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
      deleted += 1;
      bytes += asset.size;
    }
  }
  return { deleted, bytes };
}
