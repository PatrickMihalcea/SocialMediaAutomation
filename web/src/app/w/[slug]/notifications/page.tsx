import { Badge, Button, Checkbox, EmptyState } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { markAllNotificationsReadAction, markNotificationReadAction, updateNotificationPreferencesAction } from '@/app/actions/notifications';
import type { NotificationType } from '@prisma/client';

const TYPE_LABELS: Record<NotificationType, string> = {
  POST_PUBLISHED: 'Publishing success',
  POST_FAILED: 'Publishing failure',
  OAUTH_EXPIRED: 'Account connection',
  APPROVAL_REQUESTED: 'Approval request',
  APPROVAL_COMPLETED: 'Approval update',
  MEDIA_PROCESSING_COMPLETE: 'Media ready',
  MEMBER_JOINED: 'Team update',
  LIMIT_REACHED: 'Usage limit',
};

export default async function NotificationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'workspace:view');
  const [items, user] = await Promise.all([
    db.notification.findMany({
      where: { workspaceId: ctx.workspace.id, userId: ctx.user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { notificationEmailEnabled: true } }),
  ]);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="b88-eyebrow">Inbox</p><h1 className="b88-page-title mt-3">Notifications</h1></div>
      {items.some((item) => !item.readAt) && <form action={markAllNotificationsReadAction.bind(null, slug)}><Button type="submit" variant="secondary">Mark all read</Button></form>}</div>
      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <section className="b88-card">
        {items.length ? items.map((item) => (
          <article key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 border-t border-hairline-soft py-5 first:border-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <span className={`mt-2 size-2 shrink-0 rounded-full ${item.readAt ? 'bg-hairline' : 'bg-ink'}`}/>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><Badge tone="outline">{TYPE_LABELS[item.type]}</Badge>{!item.readAt && <Badge tone="ink">New</Badge>}</div>
              <h2 className="mt-2 font-[540]">{displayTitle(item.type, item.title)}</h2>
              {item.body && <p className="mt-1 text-sm">{humanizeBody(item.body)}</p>}
              <p className="b88-caption mt-2">{item.createdAt.toLocaleString()}</p>
            </div>
            <div className="col-start-2 flex flex-wrap gap-1 sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-end">
              <Button href={notificationHref(item.type, item.href, slug, ctx.workspace.id)} variant="tertiary">Open</Button>
              {!item.readAt && <form action={markNotificationReadAction.bind(null, slug, item.id)}><Button type="submit" variant="tertiary">Mark read</Button></form>}
            </div>
          </article>
        )) : <EmptyState eyebrow="Inbox clear" title="No notifications yet">Publishing updates, approval requests, account problems and completed AI media will appear here with a direct next step.</EmptyState>}
      </section>
      <aside className="b88-card self-start">
        <p className="b88-caption">Preferences</p><h2 className="b88-heading mt-2">Delivery</h2>
        <p className="mt-2 text-sm">In-app notifications stay on so important publishing failures always have a destination.</p>
        <form action={updateNotificationPreferencesAction.bind(null, slug)} className="mt-5">
          <Checkbox name="emailEnabled" label="Email notifications" description="Send a copy of workspace notifications by email." defaultChecked={user.notificationEmailEnabled} />
          <Button type="submit" variant="secondary" className="mt-4 w-full">Save preferences</Button>
        </form>
      </aside>
      </div>
    </>
  );
}

function notificationHref(type: NotificationType, href: string | null, slug: string, workspaceId: string) {
  if (href?.startsWith(`/w/${slug}/`)) return href;
  if (href?.startsWith(`/w/${workspaceId}/`)) return href.replace(`/w/${workspaceId}/`, `/w/${slug}/`);
  return {
    POST_PUBLISHED: `/w/${slug}/calendar`,
    POST_FAILED: `/w/${slug}/calendar?status=FAILED`,
    OAUTH_EXPIRED: `/w/${slug}/channels`,
    APPROVAL_REQUESTED: `/w/${slug}/calendar?status=PENDING_APPROVAL`,
    APPROVAL_COMPLETED: `/w/${slug}/calendar`,
    MEDIA_PROCESSING_COMPLETE: `/w/${slug}/media`,
    MEMBER_JOINED: `/w/${slug}/team`,
    LIMIT_REACHED: `/w/${slug}/settings/billing`,
  }[type];
}

function displayTitle(type: NotificationType, title: string) {
  if (type === 'MEDIA_PROCESSING_COMPLETE' && /^ai[-_ ]/i.test(title)) return 'AI-generated media is ready';
  return title;
}

function humanizeBody(body: string) {
  return body === 'approved' ? 'The post was approved and can continue to publishing.' : body;
}
