'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/guard';
import { enqueue } from '@/lib/queue';
import { db } from '@/lib/db';

export async function refreshAnalyticsAction(slug: string) {
  const ctx = await requireWorkspace(slug, 'analytics:view');
  await enqueue(
    'sync-workspace-analytics',
    { workspaceId: ctx.workspace.id },
    { workspaceId: ctx.workspace.id, dedupeKey: `workspace-analytics:${ctx.workspace.id}` },
  );
  revalidatePath(`/w/${slug}/analytics`);
}

/** Fetches one channel's follower counts now, rather than at the next daily sync. */
export async function refreshAccountAnalyticsAction(slug: string, accountId: string) {
  const ctx = await requireWorkspace(slug, 'analytics:view');
  const account = await db.socialAccount.findFirst({
    where: { id: accountId, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  if (!account) return;
  await enqueue(
    'sync-account-analytics',
    { socialAccountId: account.id },
    { workspaceId: ctx.workspace.id, dedupeKey: `account-analytics:${account.id}:${Date.now()}` },
  );
  revalidatePath(`/w/${slug}/channels/${account.id}`);
}
