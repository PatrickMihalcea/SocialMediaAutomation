import 'server-only';
import type { NotificationType } from '@prisma/client';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { enqueue } from '@/lib/queue';

export interface NotifyInput {
  workspaceId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
}

const APPROVAL_TYPES = new Set<NotificationType>(['APPROVAL_REQUESTED', 'APPROVAL_COMPLETED']);

export function normalizeNotificationHref(type: NotificationType, href?: string | null): string | undefined {
  if (!href || !APPROVAL_TYPES.has(type)) return href ?? undefined;
  try {
    const url = new URL(href, 'http://bridge88.local');
    const postId = url.searchParams.get('post');
    const workspace = url.pathname.match(/^\/w\/([^/]+)\//)?.[1];
    if (!postId || !workspace) return href;
    return `/w/${workspace}/posts/${encodeURIComponent(postId)}`;
  } catch {
    return href;
  }
}

export function notificationDestination(
  type: NotificationType,
  href: string | null,
  slug: string,
  workspaceId: string,
): string {
  const normalized = normalizeNotificationHref(type, href);
  if (normalized?.startsWith(`/w/${slug}/`)) return normalized;
  if (normalized?.startsWith(`/w/${workspaceId}/`)) {
    return normalized.replace(`/w/${workspaceId}/`, `/w/${slug}/`);
  }
  return {
    POST_PUBLISHED: `/w/${slug}/calendar`,
    POST_FAILED: `/w/${slug}/calendar?status=FAILED`,
    OAUTH_EXPIRED: `/w/${slug}/channels`,
    APPROVAL_REQUESTED: `/w/${slug}/team`,
    APPROVAL_COMPLETED: `/w/${slug}/team`,
    MEDIA_PROCESSING_COMPLETE: `/w/${slug}/media`,
    MEMBER_JOINED: `/w/${slug}/team`,
    LIMIT_REACHED: `/w/${slug}/settings/billing`,
  }[type];
}

/**
 * In-app notifications are the delivery guarantee; email is best-effort on top.
 * Never throws — a notification that fails must not roll back the thing it was
 * announcing.
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (input.userIds.length === 0) return;
  try {
    const recipients = await db.user.findMany({
      where: { id: { in: input.userIds } },
      select: { id: true, notificationEmailEnabled: true },
    });
    const notifications = await db.$transaction(
      recipients.map((recipient) => db.notification.create({
        data: {
        workspaceId: input.workspaceId,
        userId: recipient.id,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        href: normalizeNotificationHref(input.type, input.href) ?? null,
        },
      })),
    );
    if (env.RESEND_API_KEY) {
      const emailUsers = new Set(recipients.filter((user) => user.notificationEmailEnabled).map((user) => user.id));
      await Promise.all(notifications
        .filter((notification) => emailUsers.has(notification.userId))
        .map((notification) => enqueue(
          'send-notification-email',
          { notificationId: notification.id },
          { workspaceId: input.workspaceId },
        )));
    }
  } catch (error) {
    console.error('[notifications] failed to write', input.type, error);
  }
}

/** Everyone in the workspace, for events the whole team should see. */
export async function notifyWorkspace(
  workspaceId: string,
  notification: Omit<NotifyInput, 'workspaceId' | 'userIds'>,
): Promise<void> {
  const members = await db.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } });
  await notify({ ...notification, workspaceId, userIds: members.map((m) => m.userId) });
}

/** Members holding a given role, for approvals and channel problems. */
export async function notifyRoles(
  workspaceId: string,
  roles: ('OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER')[],
  notification: Omit<NotifyInput, 'workspaceId' | 'userIds'>,
): Promise<void> {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId, role: { in: roles } },
    select: { userId: true },
  });
  await notify({ ...notification, workspaceId, userIds: members.map((m) => m.userId) });
}

export async function markRead(userId: string, notificationId?: string, workspaceId?: string): Promise<void> {
  await db.notification.updateMany({
    where: { userId, readAt: null, ...(workspaceId ? { workspaceId } : {}), ...(notificationId ? { id: notificationId } : {}) },
    data: { readAt: new Date() },
  });
}

export async function unreadCount(userId: string, workspaceId?: string): Promise<number> {
  return db.notification.count({
    where: { userId, readAt: null, ...(workspaceId ? { workspaceId } : {}) },
  });
}
