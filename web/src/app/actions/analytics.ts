'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/guard';
import { enqueue } from '@/lib/queue';

export async function refreshAnalyticsAction(slug: string) {
  const ctx = await requireWorkspace(slug, 'analytics:view');
  await enqueue(
    'sync-workspace-analytics',
    { workspaceId: ctx.workspace.id },
    { workspaceId: ctx.workspace.id, dedupeKey: `workspace-analytics:${ctx.workspace.id}` },
  );
  revalidatePath(`/w/${slug}/analytics`);
}
