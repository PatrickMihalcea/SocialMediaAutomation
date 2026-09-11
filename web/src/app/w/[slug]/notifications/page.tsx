import { Badge, Button, Checkbox, EmptyState } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { markAllNotificationsReadAction, markNotificationReadAction, updateNotificationPreferencesAction } from '@/app/actions/notifications';
import type { NotificationType } from '@prisma/client';
import { notificationDestination } from '@/lib/notifications/service';

export const metadata = { title: 'Notifications' };

const TYPE_LABELS: Record<NotificationType, string> = {
  POST_PUBLISHED: 'Publishing success',
  POST_FAILED: 'Publishing failure',
  OAUTH_EXPIRED: 'Account connection',
  APPROVAL_REQUESTED: 'Approval request',
  APPROVAL_COMPLETED: 'Approval update',
  MEDIA_PROCESSING_COMPLETE: 'Media ready',
  AI_GENERATION_COMPLETE: 'AI generation ready',
  MEMBER_JOINED: 'Team update',
  LIMIT_REACHED: 'Usage limit',
};

const PAGE_SIZE = 8;

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const requestedPage = Number.parseInt((await searchParams).page ?? '1', 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const ctx = await requireWorkspace(slug, 'workspace:view');
  const [items, user] = await Promise.all([
    db.notification.findMany({
      where: { workspaceId: ctx.workspace.id, userId: ctx.user.id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
    }),
    db.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      select: {
        notificationEmailEnabled: true,
        notificationInAppEnabled: true,
        notificationApprovalsEnabled: true,
        notificationPublishingFailuresEnabled: true,
        notificationWeeklyDigestEnabled: true,
      },
    }),
  ]);
  const hasNextPage = items.length > PAGE_SIZE;
  const visibleItems = items.slice(0, PAGE_SIZE);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="b88-eyebrow">Inbox</p><h1 className="b88-page-title mt-3">Notifications</h1></div>
      {visibleItems.some((item) => !item.readAt) && <form action={markAllNotificationsReadAction.bind(null, slug)}><Button type="submit" variant="secondary">Mark all read</Button></form>}</div>
      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <section className="b88-card">
        {visibleItems.length ? visibleItems.map((item) => (
          <article key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-hairline-soft py-3 first:border-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <span className={`mt-2 size-2 shrink-0 rounded-full ${item.readAt ? 'bg-hairline' : 'bg-ink'}`}/>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><Badge tone="outline">{TYPE_LABELS[item.type]}</Badge>{!item.readAt && <Badge tone="ink">New</Badge>}</div>
              <h2 className="mt-2 font-[540]">{displayTitle(item.type, item.title)}</h2>
              {item.body && <p className="mt-1 text-sm">{humanizeBody(item.type, item.body)}</p>}
              <p className="b88-caption mt-2">{item.createdAt.toLocaleString()}</p>
            </div>
            <div className="col-start-2 flex flex-wrap gap-1 sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-end">
              <Button href={notificationDestination(item.type, item.href, slug, ctx.workspace.id)} variant="tertiary">Open</Button>
              {!item.readAt && <form action={markNotificationReadAction.bind(null, slug, item.id)}><Button type="submit" variant="tertiary">Mark read</Button></form>}
            </div>
          </article>
        )) : (
          <EmptyState
            eyebrow="Inbox clear"
            title="No notifications yet"
            action={<Button href={`/w/${slug}/compose`}>Create a post</Button>}
          />
        )}
        {(page > 1 || hasNextPage) && (
          <nav className="mt-4 flex items-center justify-between gap-3 border-t border-hairline-soft pt-4" aria-label="Notification pages">
            {page > 1 ? <Button href={`/w/${slug}/notifications?page=${page - 1}`} variant="secondary">Previous</Button> : <span />}
            <p className="b88-caption">Page {page}</p>
            {hasNextPage ? <Button href={`/w/${slug}/notifications?page=${page + 1}`} variant="secondary">Next</Button> : <span />}
          </nav>
        )}
      </section>
      <details className="b88-card self-start">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3">
          <span><span className="b88-caption block">Preferences</span><span className="mt-1 block text-lg font-[540]">Delivery</span></span>
          <span className="b88-caption">Open settings</span>
        </summary>
        <form action={updateNotificationPreferencesAction.bind(null, slug)} className="mt-5 border-t border-hairline-soft pt-5">
          <Checkbox name="inAppEnabled" label="In-app notifications" defaultChecked={user.notificationInAppEnabled} />
          <Checkbox name="emailEnabled" label="Email notifications" defaultChecked={user.notificationEmailEnabled} />
          <Checkbox name="approvalsEnabled" label="Approval updates" defaultChecked={user.notificationApprovalsEnabled} />
          <Checkbox name="publishingFailuresEnabled" label="Publishing failures" defaultChecked={user.notificationPublishingFailuresEnabled} />
          <Checkbox name="weeklyDigestEnabled" label="Weekly digest" description="Available when digest delivery is configured." defaultChecked={user.notificationWeeklyDigestEnabled} />
          <Button type="submit" variant="secondary" className="mt-4 w-full">Save preferences</Button>
        </form>
      </details>
      </div>
    </>
  );
}

function displayTitle(type: NotificationType, title: string) {
  if (type === 'MEDIA_PROCESSING_COMPLETE' && /^ai[-_ ]/i.test(title)) return 'AI-generated media is ready';
  const readyFilename = title.match(/^(.+\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav)) is ready$/i);
  if (readyFilename) return `${humanizeFilename(readyFilename[1])} is ready`;
  if (title.includes('_') || /\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b/i.test(title)) {
    return TYPE_LABELS[type];
  }
  return title;
}

function humanizeFilename(value: string) {
  const extensionIndex = value.lastIndexOf('.');
  const extension = extensionIndex > 0 ? value.slice(extensionIndex) : '';
  const stem = extension ? value.slice(0, extensionIndex) : value;
  return `${stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()}${extension}`;
}

function humanizeBody(type: NotificationType, body: string) {
  if (body === 'approved') return 'The post was approved and can continue to publishing.';
  if (body.includes('_') || /\b[\w.-]+\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav)\b/i.test(body)) {
    return {
      POST_PUBLISHED: 'The post was published successfully.',
      POST_FAILED: 'The post could not be published. Open it to review the next step.',
      OAUTH_EXPIRED: 'Reconnect the social account to continue publishing.',
      APPROVAL_REQUESTED: 'A post is ready for review.',
      APPROVAL_COMPLETED: 'A reviewer updated the post.',
      MEDIA_PROCESSING_COMPLETE: 'The media is ready in your library.',
      AI_GENERATION_COMPLETE: 'The generated media is ready in AI studio.',
      MEMBER_JOINED: 'A new member joined the workspace.',
      LIMIT_REACHED: 'The workspace reached a plan limit.',
    }[type];
  }
  return body;
}
