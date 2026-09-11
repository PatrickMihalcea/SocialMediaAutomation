'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/guard';
import { markRead } from '@/lib/notifications/service';
import { db } from '@/lib/db';

export async function markNotificationReadAction(slug: string, notificationId: string) {
  const ctx = await requireWorkspace(slug, 'workspace:view');
  await markRead(ctx.user.id, notificationId, ctx.workspace.id);
  revalidatePath(`/w/${slug}/notifications`);
}

export async function markAllNotificationsReadAction(slug: string) {
  const ctx = await requireWorkspace(slug, 'workspace:view');
  await markRead(ctx.user.id, undefined, ctx.workspace.id);
  revalidatePath(`/w/${slug}/notifications`);
}

export async function updateNotificationPreferencesAction(slug: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'workspace:view');
  await db.user.update({
    where: { id: ctx.user.id },
    data: {
      notificationEmailEnabled: formData.get('emailEnabled') === 'on',
      notificationInAppEnabled: formData.get('inAppEnabled') === 'on',
      notificationApprovalsEnabled: formData.get('approvalsEnabled') === 'on',
      notificationPublishingFailuresEnabled: formData.get('publishingFailuresEnabled') === 'on',
      notificationWeeklyDigestEnabled: formData.get('weeklyDigestEnabled') === 'on',
    },
  });
  revalidatePath(`/w/${slug}/notifications`);
}
