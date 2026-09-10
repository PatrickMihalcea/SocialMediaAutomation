import 'server-only';
import { db } from '@/lib/db';
import { env, publicEnv } from '@/lib/env';
import { PermanentJobError } from '@/lib/queue/runner';

/** Optional Resend delivery. In-app notifications remain the source of truth. */
export async function sendNotificationEmail(notificationId: string): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const notification = await db.notification.findUnique({
    where: { id: notificationId },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!notification) throw new PermanentJobError(`Notification ${notificationId} no longer exists`);

  const href = notification.href
    ? new URL(notification.href, publicEnv.appUrl).toString()
    : publicEnv.appUrl;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: notification.user.email,
      subject: notification.title,
      html: `<p>${escapeHtml(notification.body ?? notification.title)}</p><p><a href="${href}">Open Bridge88</a></p>`,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error('Email delivery failed.');
    Object.assign(error, {
      permanent: response.status >= 400 && response.status < 500 && response.status !== 429,
      retryAfterSeconds: response.status === 429 ? 60 : undefined,
      detail,
    });
    throw error;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

export async function sendInviteEmail(
  email: string,
  workspaceName: string,
  inviteUrl: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV !== 'production') console.info(`[team] invitation: ${inviteUrl}`);
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: email,
      subject: `Join ${workspaceName} on Bridge88`,
      html: `<p>You have been invited to ${escapeHtml(workspaceName)}.</p><p><a href="${inviteUrl}">Accept invitation</a></p>`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Invitation email delivery failed.');
}
