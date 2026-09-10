import 'server-only';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';

export function slugifyWorkspace(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'workspace';
}

export function timezoneChangeNotice(timezone: string, scheduledPosts: number): string {
  if (!scheduledPosts) return `Calendar and future scheduling now use ${timezone}.`;
  const subject = scheduledPosts === 1 ? 'publication instant remains' : 'publication instants remain';
  return `${scheduledPosts} existing ${subject} unchanged; calendar times now display in ${timezone}.`;
}

export async function availableWorkspaceSlug(name: string, currentId?: string): Promise<string> {
  const base = slugifyWorkspace(name);
  for (let suffix = 1; ; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    const existing = await db.workspace.findUnique({ where: { slug }, select: { id: true } });
    if (!existing || existing.id === currentId) return slug;
  }
}

/** Delete external objects before the database cascade removes their references. */
export async function deleteWorkspaceWithStorage(workspaceId: string): Promise<void> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      logoStorageKey: true,
      mediaAssets: { select: { storageKey: true, thumbnailKey: true } },
    },
  });
  if (!workspace) return;

  const keys = new Set<string>();
  if (workspace.logoStorageKey) keys.add(workspace.logoStorageKey);
  for (const asset of workspace.mediaAssets) {
    keys.add(asset.storageKey);
    if (asset.thumbnailKey) keys.add(asset.thumbnailKey);
  }
  await Promise.all([...keys].map((key) => storage().delete(key)));
  await db.workspace.delete({ where: { id: workspaceId } });
}
