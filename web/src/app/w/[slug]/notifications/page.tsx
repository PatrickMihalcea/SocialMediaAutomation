import Link from 'next/link';
import { Badge, Button } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { markAllNotificationsReadAction, markNotificationReadAction } from '@/app/actions/notifications';

export default async function NotificationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'workspace:view');
  const items = await db.notification.findMany({
    where: { workspaceId: ctx.workspace.id, userId: ctx.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="b88-eyebrow">Inbox</p><h1 className="b88-page-title mt-3">Notifications</h1></div>
      {items.some((item) => !item.readAt) && <form action={markAllNotificationsReadAction.bind(null, slug)}><Button type="submit" variant="secondary">Mark all read</Button></form>}</div>
      <section className="b88-card mt-8">
        {items.length ? items.map((item) => (
          <article key={item.id} className="flex flex-wrap items-start gap-4 border-t border-hairline-soft py-5 first:border-0">
            <span className={`mt-2 size-2 shrink-0 rounded-full ${item.readAt ? 'bg-hairline' : 'bg-ink'}`}/>
            <div className="min-w-0 flex-1">{item.href
              ? <Link href={item.href} className="font-[540] transition-opacity hover:opacity-80">{item.title}</Link>
              : <span className="font-[540]">{item.title}</span>}{item.body && <p className="mt-1 text-sm">{item.body}</p>}<p className="b88-caption mt-2">{item.createdAt.toLocaleString()}</p></div>
            {!item.readAt && <form action={markNotificationReadAction.bind(null, slug, item.id)}><Button type="submit" variant="tertiary">Mark read</Button></form>}
            {!item.readAt && <Badge tone="ink">New</Badge>}
          </article>
        )) : <p className="rounded-md bg-surface-soft p-5">No notifications yet.</p>}
      </section>
    </>
  );
}
