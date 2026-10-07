import 'server-only';
import { MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import type { NodeRunContext } from '@/lib/workflows/node-context';

/**
 * The reference image reaching a step, if one did.
 *
 * Shared by every step and port that takes one, because the awkward parts are
 * the same for all of them. A port with nothing wired falls back to an id
 * saved on the step, which is how a style can be set in the panel as well as
 * connected. The id arrives as plain JSON from an upstream step, so it is
 * re-queried scoped to the workspace rather than trusted. A list is read down
 * to its first entry, since a generator's output is a list even when it made
 * one picture. And a reference that has since been deleted is not worth
 * failing a run over — the prompts still describe the scene — so it degrades
 * to none rather than throwing.
 */
export async function loadReferenceImage(
  ctx: NodeRunContext,
  port = 'reference',
  fallbackId?: string | null,
): Promise<{ data: Buffer; mimeType: string } | undefined> {
  const id = referenceId(ctx, port) ?? (fallbackId || null);
  if (!id) return undefined;

  const asset = await db.mediaAsset.findFirst({
    where: { id, workspaceId: ctx.workspaceId, type: MediaType.IMAGE },
    select: { storageKey: true, mimeType: true },
  });
  if (!asset) return undefined;

  return { data: await storage().get(asset.storageKey), mimeType: asset.mimeType };
}

/**
 * The reference's id as it reached this step, for passing onward.
 *
 * A wire beats a setting, deliberately and everywhere: someone who connected a
 * picture to this step meant that picture, not the one saved on it months ago.
 */
export function referenceId(ctx: NodeRunContext, port = 'reference'): string | null {
  const raw = ctx.inputs[port];
  if (typeof raw === 'string') return raw;
  return Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : null;
}
