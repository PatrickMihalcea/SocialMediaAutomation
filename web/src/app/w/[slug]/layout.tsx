import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Bell, Search } from 'lucide-react';
import { AppNavigation } from '@/components/app-navigation';
import { Avatar, Badge } from '@/bridge88/components';
import { listMyWorkspaces, requireWorkspace } from '@/lib/auth/guard';
import { unreadCount } from '@/lib/notifications/service';
import { AppError } from '@/lib/errors';

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
  const [unread, workspaces] = await Promise.all([
    unreadCount(ctx.user.id, ctx.workspace.id),
    listMyWorkspaces(),
  ]);
  return (
    <div className="b88-app">
      <AppNavigation slug={slug} workspaces={workspaces.map(({ slug: workspaceSlug, name }) => ({ slug: workspaceSlug, name }))} />
      <header className="b88-topbar">
        <Link href={`/w/${slug}/search`} aria-label="Search workspace" className="flex items-center gap-2 text-sm">
          <Search size={17} /> <span className="hidden sm:inline">Search workspace</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href={`/w/${slug}/notifications`} aria-label="Notifications" className="relative">
            <Bell size={19} />
            {unread > 0 && <span className="absolute -right-2 -top-2"><Badge tone="ink">{unread}</Badge></span>}
          </Link>
          <Link href="/account" aria-label="Account"><Avatar name={ctx.user.name ?? ctx.user.email} src={ctx.user.image} /></Link>
        </div>
      </header>
      <main id="main-content" className="b88-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
