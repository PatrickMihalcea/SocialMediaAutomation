import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Bell, Search } from 'lucide-react';
import { AppNavigation } from '@/components/app-navigation';
import { Avatar, Badge } from '@/bridge88/components';
import { listMyWorkspaces, requireWorkspace } from '@/lib/auth/guard';
import { unreadCount } from '@/lib/notifications/service';
import { AppError } from '@/lib/errors';

function NotificationLink({
  slug,
  unread,
}: {
  slug: string;
  unread?: number;
}) {
  return (
    <Link
      href={`/w/${slug}/notifications`}
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      className="relative flex size-10 items-center justify-center rounded-full"
    >
      <Bell size={19} />
      {Boolean(unread) && <span className="absolute -right-1 -top-1"><Badge tone="ink">{unread}</Badge></span>}
    </Link>
  );
}

async function NotificationStatus({
  slug,
  userId,
  workspaceId,
}: {
  slug: string;
  userId: string;
  workspaceId: string;
}) {
  // Notifications are useful but not structural. A delayed or failed count must
  // not hold the workspace shell or turn every feature into an error page.
  const unread = await unreadCount(userId, workspaceId).catch(() => 0);
  return <NotificationLink slug={slug} unread={unread} />;
}

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let ctx: Awaited<ReturnType<typeof requireWorkspace>>;
  try {
    ctx = await requireWorkspace(slug, 'workspace:view');
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const workspaces = await listMyWorkspaces();
  return (
    <div className="b88-app">
      <AppNavigation slug={slug} workspaces={workspaces.map(({ slug: workspaceSlug, name }) => ({ slug: workspaceSlug, name }))} />
      <header className="b88-topbar">
        <Link href={`/w/${slug}/search`} aria-label="Search workspace" className="flex min-h-11 min-w-11 items-center gap-2 rounded-pill px-3 text-sm">
          <Search size={17} /> <span className="hidden sm:inline">Search workspace</span>
        </Link>
        <div className="flex items-center gap-3">
          <Suspense fallback={<NotificationLink slug={slug} />}>
            <NotificationStatus slug={slug} userId={ctx.user.id} workspaceId={ctx.workspace.id} />
          </Suspense>
          <Link href="/account" aria-label="Account" className="flex size-10 items-center justify-center rounded-full">
            <Avatar name={ctx.user.name ?? ctx.user.email} src={ctx.user.image} />
          </Link>
        </div>
      </header>
      <main id="main-content" className="b88-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
