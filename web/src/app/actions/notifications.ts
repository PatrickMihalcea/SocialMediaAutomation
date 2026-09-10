'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/guard';
import { markRead } from '@/lib/notifications/service';

export async function markNotificationReadAction(slug: string, notificationId: string) {
  const ctx = await requireWorkspace(slug, 'workspace:view');
  await markRead(ctx.user.id, notificationId);
  revalidatePath(`/w/${slug}/notifications`);
}

export async function markAllNotificationsReadAction(slug: string) {
  const ctx = await requireWorkspace(slug, 'workspace:view');
  await markRead(ctx.user.id);
  revalidatePath(`/w/${slug}/notifications`);
}
