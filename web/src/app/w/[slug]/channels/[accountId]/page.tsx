import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { Avatar, Badge, Button, EmptyState, StatCard } from '@/bridge88/components';
import { PendingButton } from '@/components/action-ui';
import { PlatformGlyph } from '@/components/visuals';
import { refreshAccountAnalyticsAction } from '@/app/actions/analytics';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { formatMetric, sumReported, type NullableMetric } from '@/lib/analytics/aggregate';
import { POST_PLATFORM_STATUS_LABELS } from '@/lib/posts/labels';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { formatInZone, relativeLabel } from '@/lib/scheduling/time';

export const metadata = { title: 'Account dashboard' };

const STATUS = {
  ACTIVE: { label: 'Connected', tone: 'mint' },
  EXPIRED: { label: 'Authorization expired', tone: 'coral' },
  REVOKED: { label: 'Access revoked', tone: 'coral' },
  ERROR: { label: 'Connection issue', tone: 'cream' },
  DISCONNECTED: { label: 'Disconnected', tone: 'outline' },
} as const;

/** How far back the follower trend reaches. */
const TREND_DAYS = 90;

/**
 * One channel at a glance: who it is, how it is growing, and what has been
 * posted to it. Everything here is scoped to the one account, so it answers
 * "how is this page doing" without filtering the workspace-wide analytics.
 */
export default async function AccountDashboardPage({
  params,
}: {
  params: Promise<{ slug: string; accountId: string }>;
}) {
  const { slug, accountId } = await params;
  const ctx = await requireWorkspace(slug, 'channel:view');
  const since = new Date(Date.now() - TREND_DAYS * 24 * 60 * 60 * 1000);

  const account = await db.socialAccount.findFirst({
    where: { id: accountId, workspaceId: ctx.workspace.id },
    include: {
      snapshots: {
        where: { capturedOn: { gte: since } },
        orderBy: { capturedOn: 'asc' },
        select: { capturedOn: true, followers: true, following: true },
      },
    },
  });
  if (!account) notFound();

  const [posts, published, reported] = await Promise.all([
    db.postPlatform.findMany({
      where: { socialAccountId: account.id, workspaceId: ctx.workspace.id },
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
      take: 25,
      select: {
        id: true,
        text: true,
        status: true,
        publishedAt: true,
        platformUrl: true,
        errorMessage: true,
        post: { select: { id: true, title: true, scheduledAt: true } },
        analytics: { select: { videoViews: true, impressions: true, likes: true, comments: true, shares: true } },
      },
    }),
    db.postPlatform.count({ where: { socialAccountId: account.id, status: 'PUBLISHED' } }),
    db.postAnalytics.findMany({
      where: { postPlatform: { socialAccountId: account.id } },
      select: { videoViews: true, impressions: true, likes: true, comments: true, shares: true },
    }),
  ]);

  const metadata = account.metadata as {
    profileUrl?: string;
    verified?: boolean;
    followers?: number;
    following?: number;
    mock?: boolean;
  };
  const latest = account.snapshots.at(-1);
  const followers: NullableMetric = latest?.followers ?? metadata.followers ?? null;
  const following: NullableMetric = latest?.following ?? metadata.following ?? null;
  const first = account.snapshots.find((snapshot) => snapshot.followers != null)?.followers ?? null;
  const growth = followers != null && first != null && account.snapshots.length > 1 ? followers - first : null;
  const views = sumReported(reported.map((row) => row.videoViews ?? row.impressions));
  const status = STATUS[account.status];
  const trend = account.snapshots
    .filter((snapshot): snapshot is typeof snapshot & { followers: number } => snapshot.followers != null);

  return (
    <>
      <Link href={`/w/${slug}/channels`} className="inline-flex items-center gap-2 text-sm underline underline-offset-4">
        <ArrowLeft size={16} aria-hidden /> Social accounts
      </Link>

      <header className="mt-6 flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={account.accountName} src={account.avatarUrl} size={64} />
          <div className="min-w-0">
            <p className="b88-eyebrow flex items-center gap-2">
              <PlatformGlyph platform={account.platform} size={16} />
              {PLATFORM_LABELS[account.platform]}
              {metadata.mock ? ' · demo account' : ''}
            </p>
            <h1 className="b88-page-title mt-2 break-words">{account.accountName}</h1>
            <p className="mt-2 text-sm">
              {account.accountHandle ?? 'No public handle reported'}
              {metadata.verified ? ' · Verified' : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {metadata.profileUrl && (
            <a
              href={metadata.profileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-1 px-2 text-sm underline underline-offset-4"
            >
              View profile <ExternalLink size={14} aria-hidden />
            </a>
          )}
          {account.status !== 'ACTIVE' && ctx.can('channel:connect') && !metadata.mock && (
            <Button
              variant="secondary"
              href={`/api/oauth/${account.platform.toLowerCase()}/start?workspace=${encodeURIComponent(slug)}&account=${encodeURIComponent(account.id)}`}
            >
              <RefreshCw size={16} aria-hidden /> Reconnect
            </Button>
          )}
          {account.status === 'ACTIVE' && (
            <form action={refreshAccountAnalyticsAction.bind(null, slug, account.id)}>
              <PendingButton type="submit" variant="tertiary" pendingLabel="Refreshing">
                <RefreshCw size={16} aria-hidden /> Refresh stats
              </PendingButton>
            </form>
          )}
        </div>
      </header>

      <p className="b88-caption mt-4">
        {account.lastSyncedAt
          ? `Stats last fetched ${relativeLabel(account.lastSyncedAt, ctx.workspace.timezone)}`
          : 'Stats not fetched yet. Refresh to fetch them now.'}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Followers" value={formatMetric(followers)} delta={growth != null ? `${growth >= 0 ? '+' : ''}${growth.toLocaleString()} in ${TREND_DAYS} days` : undefined} />
        <StatCard label="Following" value={formatMetric(following)} />
        <StatCard label="Posts published" value={published.toLocaleString()} />
        <StatCard label="Views" value={formatMetric(views)} />
        <StatCard label="Likes" value={formatMetric(sumReported(reported.map((row) => row.likes)))} />
        <StatCard label="Comments" value={formatMetric(sumReported(reported.map((row) => row.comments)))} />
        <StatCard label="Shares" value={formatMetric(sumReported(reported.map((row) => row.shares)))} />
      </div>

      <section className="b88-card mt-6">
        <p className="b88-caption">Last {TREND_DAYS} days</p>
        <h2 className="b88-heading mt-2">Followers</h2>
        {trend.length > 1 ? (
          <FollowerTrend points={trend} timezone={ctx.workspace.timezone} />
        ) : (
          <p className="mt-4">
            The trend appears once there are two days of follower counts. They are fetched daily.
          </p>
        )}
      </section>

      <section className="b88-card mt-6 overflow-x-auto">
        <p className="b88-caption">Posts</p>
        <h2 className="b88-heading mb-5 mt-2">Recent posts to this account</h2>
        {posts.length ? (
          <table className="b88-table min-w-[760px] [&_:is(th,td):first-child]:pl-0 [&_:is(th,td):last-child]:pr-0">
            <thead>
              <tr><th>Post</th><th>Status</th><th>Date</th><th>Views</th><th>Likes</th><th>Comments</th><th>Live post</th></tr>
            </thead>
            <tbody>
              {posts.map((row) => {
                const date = row.publishedAt ?? row.post.scheduledAt;
                return (
                  <tr key={row.id}>
                    <td className="max-w-72">
                      <Link className="font-[480]" href={`/w/${slug}/posts/${row.post.id}`}>
                        {row.post.title?.trim() || row.text.trim().slice(0, 60) || 'Untitled post'}
                      </Link>
                      {row.status === 'FAILED' && row.errorMessage && (
                        <p className="b88-caption mt-1 whitespace-normal">{row.errorMessage}</p>
                      )}
                    </td>
                    <td>
                      <Badge tone={row.status === 'FAILED' ? 'coral' : row.status === 'PUBLISHED' ? 'mint' : 'outline'}>
                        {POST_PLATFORM_STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap">{date ? formatInZone(date, ctx.workspace.timezone, 'd LLL yyyy') : '—'}</td>
                    <td className="tabular-nums">{formatMetric(row.analytics?.videoViews ?? row.analytics?.impressions ?? null)}</td>
                    <td className="tabular-nums">{formatMetric(row.analytics?.likes ?? null)}</td>
                    <td className="tabular-nums">{formatMetric(row.analytics?.comments ?? null)}</td>
                    <td>
                      {row.platformUrl ? (
                        <a href={row.platformUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
                          Open <ExternalLink size={14} aria-hidden />
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState
            eyebrow="No posts"
            title="Nothing posted to this account yet"
            action={ctx.can('post:create') ? <Button href={`/w/${slug}/compose`}>Create post</Button> : undefined}
          >
            Posts sent to {account.accountName} appear here with their results.
          </EmptyState>
        )}
      </section>
    </>
  );
}

/** Follower count per day, scaled to the range it actually covers. */
function FollowerTrend({
  points,
  timezone,
}: {
  points: { capturedOn: Date; followers: number }[];
  timezone: string;
}) {
  const width = 600;
  const height = 170;
  const pad = 8;
  const values = points.map((point) => point.followers);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const coordinates = points.map((point, index) => {
    const x = pad + (index / (points.length - 1)) * (width - pad * 2);
    const y = height - pad - ((point.followers - low) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <>
      <svg className="mt-5 h-44 w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Followers from ${low.toLocaleString()} to ${high.toLocaleString()}`}>
        <polyline points={coordinates.join(' ')} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="b88-caption mt-2 flex justify-between tabular-nums">
        <span>{formatInZone(points[0].capturedOn, timezone, 'd LLL')} · {points[0].followers.toLocaleString()}</span>
        <span>{formatInZone(points.at(-1)!.capturedOn, timezone, 'd LLL')} · {points.at(-1)!.followers.toLocaleString()}</span>
      </div>
    </>
  );
}
