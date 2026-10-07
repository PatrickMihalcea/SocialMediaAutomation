import 'server-only';
import { MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import type { NodeRunContext } from '@/lib/workflows/node-context';

/**
 * The reference image reaching a step, if one did.
 *
 * Shared by the two steps that take one, because the awkward parts are the
 * same for both. The id arrives as plain JSON from an upstream step, so it is
 * re-queried scoped to the workspace rather than trusted. A list is read down
 * to its first entry, since a generator's output is a list even when it made
 * one picture. And a reference that has since been deleted is not worth
 * failing a run over — the prompts still describe the scene — so it degrades
 * to none rather than throwing.
 */
export async function loadReferenceImage(
  ctx: NodeRunContext,
): Promise<{ data: Buffer; mimeType: string } | undefined> {
  const raw = ctx.inputs.reference;
  const id = typeof raw === 'string'
    ? raw
    : Array.isArray(raw) && typeof raw[0] === 'string'
      ? raw[0]
      : null;
  if (!id) return undefined;

  const asset = await db.mediaAsset.findFirst({
    where: { id, workspaceId: ctx.workspaceId, type: MediaType.IMAGE },
    select: { storageKey: true, mimeType: true },
  });
  if (!asset) return undefined;

  return { data: await storage().get(asset.storageKey), mimeType: asset.mimeType };
}

/** The reference's id as it reached this step, for passing onward. */
export function referenceId(ctx: NodeRunContext): string | null {
  const raw = ctx.inputs.reference;
  if (typeof raw === 'string') return raw;
  return Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : null;
}
