import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Bell, Search } from 'lucide-react';
import { AppNavigation } from '@/components/app-navigation';
import { Avatar } from '@/bridge88/components';
import { listMyWorkspaces, requireWorkspace } from '@/lib/auth/guard';
import { unreadCount } from '@/lib/notifications/service';
import { AppError } from '@/lib/errors';
import { profileImageSrc } from '@/lib/users/profile-image-src';

function NotificationLink({
  slug,
  unread,
}: {
  slug: string;
  unread?: number;
}) {
  const visibleUnread = unread && unread > 99 ? '99+' : unread;
  return (
    <Link
      href={`/w/${slug}/notifications`}
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      className="relative flex size-10 items-center justify-center rounded-full"
    >
      <Bell size={19} />
      {Boolean(unread) && (
        <span
          aria-hidden="true"
          className="absolute right-0 top-0 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-[var(--canvas)] bg-[var(--primary)] px-[3px] font-mono text-[10px] font-bold leading-none tabular-nums text-[var(--on-primary)]"
        >
          {visibleUnread}
        </span>
      )}
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
  let workspaces: Awaited<ReturnType<typeof listMyWorkspaces>>;
  try {
    [ctx, workspaces] = await Promise.all([
      requireWorkspace(slug, 'workspace:view'),
      listMyWorkspaces(),
    ]);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
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
          <Link
            href="/account"
            prefetch
            aria-label="Profile settings"
            title="Profile settings"
            className="b88-icon-button flex h-10 items-center gap-2 rounded-pill px-1 pr-3 text-sm font-[480] transition-opacity hover:opacity-80"
          >
            <Avatar name={ctx.user.name ?? ctx.user.email} src={await profileImageSrc(ctx.user.image)} size={32} />
            <span>Profile</span>
          </Link>
        </div>
      </header>
      <main id="main-content" className="b88-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
