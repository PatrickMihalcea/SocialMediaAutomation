import { DateTime } from 'luxon';
import Link from 'next/link';
import { Badge, Button, EmptyState, StatCard } from '@/bridge88/components';
import { StatusGlyph } from '@/components/visuals';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { formatInZone } from '@/lib/scheduling/time';

function statusLabel(status: string) {
  const words = status.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug, 'workspace:view');
  const localNow = DateTime.now().setZone(workspace.timezone);
  const todayStart = localNow.startOf('day').toUTC().toJSDate();
  const weekEnd = localNow.endOf('week').toUTC().toJSDate();

  const [
    today,
    thisWeek,
    published,
    failed,
    accountCount,
    failedPosts,
    scheduledPosts,
    draftPosts,
    latestSnapshots,
  ] = await Promise.all([
    db.post.count({ where: { workspaceId: workspace.id, status: 'SCHEDULED', scheduledAt: { gte: todayStart, lte: localNow.endOf('day').toUTC().toJSDate() } } }),
    db.post.count({ where: { workspaceId: workspace.id, status: 'SCHEDULED', scheduledAt: { gte: todayStart, lte: weekEnd } } }),
    db.post.count({ where: { workspaceId: workspace.id, status: 'PUBLISHED' } }),
    db.post.count({ where: { workspaceId: workspace.id, status: 'FAILED' } }),
    db.socialAccount.count({ where: { workspaceId: workspace.id, status: 'ACTIVE' } }),
    db.post.findMany({
      where: { workspaceId: workspace.id, status: 'FAILED' },
      include: { platforms: { select: { platform: true } } },
      orderBy: { createdAt: 'desc' },
      take: 7,
    }),
    db.post.findMany({
      where: { workspaceId: workspace.id, status: 'SCHEDULED', scheduledAt: { gte: localNow.toUTC().toJSDate() } },
      include: { platforms: { select: { platform: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 7,
    }),
    db.post.findMany({
      where: { workspaceId: workspace.id, status: { in: ['DRAFT', 'REJECTED', 'PENDING_APPROVAL'] } },
      include: { platforms: { select: { platform: true } } },
      orderBy: { createdAt: 'desc' },
      take: 7,
    }),
    db.analyticsSnapshot.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { capturedOn: 'desc' },
      distinct: ['socialAccountId'],
    }),
  ]);

  const recent = [...failedPosts, ...scheduledPosts, ...draftPosts].slice(0, 7);
  const followers = latestSnapshots.reduce((sum, item) => sum + (item.followers ?? 0), 0);
  const engagements = latestSnapshots.reduce((sum, item) => sum + (item.engagements ?? 0), 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="b88-eyebrow">Dashboard · {workspace.timezone}</p>
          <h1 className="b88-page-title mt-3">Publishing overview</h1>
        </div>
        <Button href={`/w/${slug}/compose`}>Create post</Button>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Scheduled today" value={String(today)} />
        <StatCard label="Scheduled this week" value={String(thisWeek)} />
        <StatCard label="Connected accounts" value={String(accountCount)} />
        <Link href={`/w/${slug}/calendar?status=FAILED`} className="block transition-opacity hover:opacity-80">
          <StatCard label="Failed posts" value={String(failed)} />
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,.8fr)]">
        <section className="b88-card">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="b88-caption">Queue</p>
              <h2 className="b88-heading mt-2">Next posts</h2>
            </div>
            <Button href={`/w/${slug}/calendar`} variant="secondary">Open calendar</Button>
          </div>
          {recent.length ? (
            <div>
              {recent.map((post) => (
                <Link key={post.id} href={`/w/${slug}/calendar?post=${post.id}`} className="flex items-center gap-4 border-t border-hairline-soft py-4 transition-opacity first:border-0 hover:opacity-80">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-[var(--block-cream)]">
                    <StatusGlyph status={post.status} size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-[480]">{post.title ?? 'Untitled post'}</p>
                    <p className="b88-caption mt-1">
                      {post.scheduledAt ? formatInZone(post.scheduledAt, workspace.timezone) : 'No publishing time'}
                      {' · '}
                      {post.platforms.map((p) => PLATFORM_LABELS[p.platform]).join(', ')}
                    </p>
                  </div>
                  <Badge tone={post.status === 'FAILED' || post.status === 'REJECTED' ? 'coral' : post.status === 'PENDING_APPROVAL' ? 'cream' : post.status === 'DRAFT' ? 'outline' : 'lime'}>
                    {statusLabel(post.status)}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState eyebrow="No posts yet" title="Your queue is clear" action={<Button href={`/w/${slug}/compose`}>New post</Button>}>
              Drafts and scheduled posts land here.
            </EmptyState>
          )}
        </section>

        <section className="rounded-[24px] bg-[var(--block-lilac)] p-8">
          <p className="b88-caption">Workspace totals</p>
          <p className="mt-8 text-5xl font-[340]">{followers.toLocaleString()}</p>
          <p className="mt-2">followers reported by connected channels</p>
          <div className="my-6 border-t border-black/15" />
          <p className="text-3xl font-[340]">{engagements.toLocaleString()}</p>
          <p className="mt-2">engagements in the latest snapshots</p>
          <p className="b88-caption mt-8">{published} posts published all time</p>
        </section>
      </div>
    </>
  );
}
