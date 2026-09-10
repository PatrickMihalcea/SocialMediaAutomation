import Form from 'next/form';
import Link from 'next/link';
import { Badge, Button, EmptyState, Field, Select, StatCard, StatusMessage } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { formatMetric, sumReported, type NullableMetric } from '@/lib/analytics/aggregate';
import { refreshAnalyticsAction } from '@/app/actions/analytics';
import { percentageChange, previousRange, resolveAnalyticsRange } from '@/lib/analytics/range';
import type { Platform, Prisma } from '@prisma/client';
import { PendingButton } from '@/components/action-ui';

/**
 * StatCard sets its value at 38px, which reads as a headline for the
 * "Not reported" sentence a null metric carries. The wrapper drops that one
 * string to body size instead of forking the component.
 */
function Metric({ label, value, delta }: { label: string; value: NullableMetric | string; delta?: string }) {
  return (
    <div className={value === null ? '[&_p+p]:text-[15px] [&_p+p]:font-[330] [&_p+p]:leading-normal' : ''}>
      <StatCard label={label} value={typeof value === 'string' ? value : formatMetric(value)} delta={delta} />
    </div>
  );
}

type SearchParams = { range?: string; from?: string; to?: string; account?: string; platform?: string };
type PerformanceRow = Prisma.PostAnalyticsGetPayload<{
  include: { postPlatform: { include: { post: { include: { campaign: true } }; socialAccount: true } } };
}>;

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const filters = await searchParams;
  const ctx = await requireWorkspace(slug, 'analytics:view');
  const range = resolveAnalyticsRange(filters);
  const comparison = previousRange(range);
  const accountWhere = filters.account ? { socialAccountId: filters.account } : {};
  const platformWhere = filters.platform ? { platform: filters.platform as Platform } : {};
  const [accounts, snapshots, previousSnapshots, postRows, previousPostRows] = await Promise.all([
    db.socialAccount.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { accountName: 'asc' },
      select: { id: true, accountName: true, platform: true },
    }),
    db.analyticsSnapshot.findMany({
      where: { workspaceId: ctx.workspace.id, capturedOn: { gte: range.from, lte: range.to }, ...accountWhere, ...platformWhere },
      orderBy: { capturedOn: 'desc' },
    }),
    db.analyticsSnapshot.findMany({
      where: { workspaceId: ctx.workspace.id, capturedOn: { gte: comparison.from, lte: comparison.to }, ...accountWhere, ...platformWhere },
      orderBy: { capturedOn: 'desc' },
    }),
    db.postAnalytics.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        fetchedAt: { gte: range.from, lte: range.to },
        ...platformWhere,
        ...(filters.account ? { postPlatform: { socialAccountId: filters.account } } : {}),
      },
      include: { postPlatform: { include: { post: { include: { campaign: true } }, socialAccount: true } } },
      orderBy: { impressions: 'desc' },
    }),
    db.postAnalytics.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        fetchedAt: { gte: comparison.from, lte: comparison.to },
        ...platformWhere,
        ...(filters.account ? { postPlatform: { socialAccountId: filters.account } } : {}),
      },
    }),
  ]);
  const topPosts = postRows.slice(0, 5);
  const worstPosts = [...postRows]
    .filter((row) => row.impressions !== null)
    .sort((a, b) => (a.impressions ?? 0) - (b.impressions ?? 0))
    .slice(0, 5);
  const latest = new Map<string, (typeof snapshots)[number]>();
  for (const item of snapshots) if (!latest.has(item.socialAccountId)) latest.set(item.socialAccountId, item);
  const current = [...latest.values()];
  const previousLatest = new Map<string, (typeof previousSnapshots)[number]>();
  for (const item of previousSnapshots) if (!previousLatest.has(item.socialAccountId)) previousLatest.set(item.socialAccountId, item);
  const previous = [...previousLatest.values()];
  const snapshotTotal = (rows: typeof current, field: 'followers' | 'impressions' | 'reach' | 'engagements') =>
    sumReported(rows.map((item) => item[field]));
  const postTotal = (
    rows: { likes: number | null; comments: number | null; shares: number | null; saves: number | null; clicks: number | null }[],
    field: 'likes' | 'comments' | 'shares' | 'saves' | 'clicks',
  ) =>
    sumReported(rows.map((item) => item[field]));
  const total = (field: 'followers' | 'impressions' | 'reach' | 'engagements') =>
    sumReported(current.map((item) => item[field]));
  const followerGrowth = current.length
    ? sumReported(current.map((item) => {
        const oldest = [...snapshots].reverse().find((snapshot) => snapshot.socialAccountId === item.socialAccountId);
        return item.followers === null || oldest?.followers == null ? null : item.followers - oldest.followers;
      }))
    : null;
  const series = [...snapshots].reverse();
  const chartValues = series.map((item) => item.reach).filter((value): value is number => value !== null);
  const maxReach = Math.max(...chartValues, 1);
  const points = series.map((item, index) => {
    if (item.reach === null) return null;
    const x = series.length <= 1 ? 0 : (index / (series.length - 1)) * 600;
    return `${x},${160 - (item.reach / maxReach) * 150}`;
  });
  const aggregateEngagements = postRows.reduce((sum, row) =>
    sum + (row.likes ?? 0) + (row.comments ?? 0) + (row.shares ?? 0) + (row.saves ?? 0), 0);
  const aggregateReach = postRows.reduce((sum, row) => sum + (row.reach ?? 0), 0);
  const engagementRate = aggregateReach ? (aggregateEngagements / aggregateReach) * 100 : null;
  const byPlatform = new Map<Platform, { impressions: number; engagements: number; posts: number }>();
  for (const row of postRows) {
    const value = byPlatform.get(row.platform) ?? { impressions: 0, engagements: 0, posts: 0 };
    value.impressions += row.impressions ?? 0;
    value.engagements += (row.likes ?? 0) + (row.comments ?? 0) + (row.shares ?? 0) + (row.saves ?? 0);
    value.posts++;
    byPlatform.set(row.platform, value);
  }
  const campaigns = new Map<string, { name: string; impressions: number; engagements: number; posts: number }>();
  for (const row of postRows) {
    const campaign = row.postPlatform.post.campaign;
    if (!campaign) continue;
    const value = campaigns.get(campaign.id) ?? { name: campaign.name, impressions: 0, engagements: 0, posts: 0 };
    value.impressions += row.impressions ?? 0;
    value.engagements += (row.likes ?? 0) + (row.comments ?? 0) + (row.shares ?? 0) + (row.saves ?? 0);
    value.posts++;
    campaigns.set(campaign.id, value);
  }
  const postingTimes = new Map<number, { impressions: number; posts: number }>();
  for (const row of postRows) {
    const hour = row.postPlatform.publishedAt?.getUTCHours();
    if (hour === undefined) continue;
    const value = postingTimes.get(hour) ?? { impressions: 0, posts: 0 };
    value.impressions += row.impressions ?? 0;
    value.posts++;
    postingTimes.set(hour, value);
  }
  const bestTimes = [...postingTimes.entries()]
    .sort((a, b) => b[1].impressions / b[1].posts - a[1].impressions / a[1].posts)
    .slice(0, 3);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="b88-eyebrow">Measurement</p><h1 className="b88-page-title mt-3">Analytics</h1></div>
        <div className="flex flex-wrap gap-2">
          <Button href={`/w/${slug}/analytics/export?${new URLSearchParams(filters as Record<string, string>)}`} variant="secondary">Export CSV</Button>
          <form action={refreshAnalyticsAction.bind(null, slug)}>
            <PendingButton type="submit" variant="secondary" pendingLabel="Refreshing analytics">
              Refresh analytics
            </PendingButton>
          </form>
        </div>
      </div>
      <p className="mt-4 max-w-2xl">Null metrics remain “not reported.” Bridge88 never turns a platform omission into a zero.</p>
      <Form action={`/w/${slug}/analytics`} className="mt-6 grid gap-3 rounded-lg bg-surface-soft p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select name="range" label="Date range" defaultValue={range.preset}>
          <option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="custom">Custom</option>
        </Select>
        <Select name="platform" label="Platform" defaultValue={filters.platform ?? ''}>
          <option value="">All platforms</option>
          {[...new Set(accounts.map((account) => account.platform))].map((platform) => <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}</option>)}
        </Select>
        <Select name="account" label="Account" defaultValue={filters.account ?? ''}>
          <option value="">All accounts</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.accountName} · {PLATFORM_LABELS[account.platform]}</option>)}
        </Select>
        <Button type="submit" className="self-end">Apply filters</Button>
        {range.preset === 'custom' && <>
          <Field name="from" label="Start date" type="date" defaultValue={filters.from ?? ''} />
          <Field name="to" label="End date" type="date" defaultValue={filters.to ?? ''} />
        </>}
        {(filters.range || filters.account || filters.platform) && <Button href={`/w/${slug}/analytics`} variant="tertiary" className="self-end">Clear filters</Button>}
      </Form>
      {range.error && <StatusMessage tone="error" className="mt-4">{range.error}</StatusMessage>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Followers" value={total('followers')} delta={percentageChange(total('followers'), snapshotTotal(previous, 'followers'))} />
        <Metric label="Follower growth" value={followerGrowth} />
        <Metric label="Impressions" value={total('impressions')} delta={percentageChange(total('impressions'), snapshotTotal(previous, 'impressions'))} />
        <Metric label="Reach" value={total('reach')} delta={percentageChange(total('reach'), snapshotTotal(previous, 'reach'))} />
        <Metric label="Likes" value={postTotal(postRows, 'likes')} delta={percentageChange(postTotal(postRows, 'likes'), postTotal(previousPostRows, 'likes'))} />
        <Metric label="Comments" value={postTotal(postRows, 'comments')} />
        <Metric label="Shares" value={postTotal(postRows, 'shares')} />
        <Metric label="Saves" value={postTotal(postRows, 'saves')} />
        <Metric label="Clicks" value={postTotal(postRows, 'clicks')} />
        <Metric label="Engagement rate" value={engagementRate === null ? null : `${engagementRate.toFixed(1)}%`} />
      </div>
      <section className="b88-card mt-6">
        <p className="b88-caption">Selected period</p><h2 className="b88-heading mt-2">Reported reach</h2>
        {chartValues.length ? <svg className="mt-5 h-44 w-full" viewBox="0 0 600 170" role="img" aria-label="Reported reach trend">
          <polyline points={points.filter(Boolean).join(' ')} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </svg> : <EmptyState eyebrow="No analytics" title="Publish a post to start measuring" action={<Button href={`/w/${slug}/compose`}>Create post</Button>}>Connect a social account, publish a post, then refresh after the platform reports its metrics.</EmptyState>}
      </section>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Breakdown title="Platform comparison" rows={[...byPlatform.entries()].map(([platform, value]) => ({ key: platform, label: PLATFORM_LABELS[platform], ...value }))} />
        <Breakdown title="Campaign performance" rows={[...campaigns.entries()].map(([key, value]) => ({ key, label: value.name, ...value }))} />
      </div>
      <section className="b88-card mt-6">
        <p className="b88-caption">Publishing times</p><h2 className="b88-heading mt-2">Best times by average impressions</h2>
        {bestTimes.length ? <div className="mt-4 grid gap-3 sm:grid-cols-3">{bestTimes.map(([hour, value]) => (
          <div key={hour} className="rounded-md bg-surface-soft p-4"><p className="font-[540]">{String(hour).padStart(2, '0')}:00 UTC</p><p className="b88-caption mt-2">{Math.round(value.impressions / value.posts).toLocaleString()} average impressions · {value.posts} posts</p></div>
        ))}</div> : <p className="mt-4">Published posts in this period do not have timing data yet.</p>}
      </section>
      <PerformanceTable title="Top-performing posts" rows={topPosts} slug={slug} />
      <PerformanceTable title="Worst-performing posts" rows={worstPosts} slug={slug} />
      {!postRows.length && !snapshots.length && (
        <section className="mt-6">
          <EmptyState
            eyebrow="No measurements"
            title="Analytics arrive after publishing"
            action={<Button href={`/w/${slug}/compose`}>Create post</Button>}
          >
            Connect a social account and publish a post. Bridge88 schedules the first analytics synchronization one hour after it goes live.
          </EmptyState>
        </section>
      )}
    </>
  );
}

function PerformanceTable({ title, rows, slug }: { title: string; rows: PerformanceRow[]; slug: string }) {
  return (
    <section className="b88-card mt-6 overflow-x-auto">
      <p className="b88-caption">Post analytics</p><h2 className="b88-heading mt-2 mb-5">{title}</h2>
      {rows.length ? (
        <table className="b88-table min-w-[760px] [&_:is(th,td):first-child]:pl-0 [&_:is(th,td):last-child]:pr-0">
          <thead><tr><th>Post</th><th>Platform</th><th>Impressions</th><th>Engagement</th><th>Clicks</th><th>Action</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.id}>
              <td><Link className="font-[480]" href={`/w/${slug}/posts/${row.postPlatform.post.id}`}>{row.postPlatform.post.title ?? (row.postPlatform.text.slice(0, 60) || 'Untitled post')}</Link></td>
              <td><Badge tone="outline">{PLATFORM_LABELS[row.platform]}</Badge></td>
              <td>{metric(row.impressions)}</td><td>{row.engagementRate == null ? 'Not reported' : `${(row.engagementRate * 100).toFixed(1)}%`}</td><td>{metric(row.clicks)}</td>
              <td><Button href={`/w/${slug}/posts/${row.postPlatform.post.id}`} variant="tertiary">View analytics</Button></td>
            </tr>
          ))}</tbody>
        </table>
      ) : <p>No post-level analytics were reported in this period.</p>}
    </section>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { key: string; label: string; impressions: number; engagements: number; posts: number }[] }) {
  return (
    <section className="b88-card">
      <p className="b88-caption">Comparison</p><h2 className="b88-heading mt-2">{title}</h2>
      {rows.length ? <div className="mt-4">{rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[1fr_auto] gap-3 border-t border-hairline-soft py-3 first:border-0">
          <p className="font-[480]">{row.label}</p>
          <p className="text-right">{row.impressions.toLocaleString()} impressions</p>
          <p className="b88-caption">{row.posts} reported posts</p>
          <p className="b88-caption text-right">{row.engagements.toLocaleString()} engagements</p>
        </div>
      ))}</div> : <p className="mt-4">No comparable data in this period.</p>}
    </section>
  );
}

const metric = formatMetric;
