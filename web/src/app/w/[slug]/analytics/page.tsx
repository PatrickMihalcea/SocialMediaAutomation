import { Suspense } from 'react';
import Form from 'next/form';
import Link from 'next/link';
import { Button, EmptyState, Field, Select, StatusMessage } from '@/bridge88/components';
import { BarChart, ChartCard, DonutChart, MetricTile, RankBars, TrendChart, CHART_COLOURS, short } from '@/bridge88/charts';
import { PLATFORM_COLOURS } from '@/lib/social/platform-colours';
import { formatInZone } from '@/lib/scheduling/time';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { formatMetric, sumReported } from '@/lib/analytics/aggregate';
import { refreshAnalyticsAction } from '@/app/actions/analytics';
import { percentageChange, previousRange, resolveAnalyticsRange } from '@/lib/analytics/range';
import type { Platform, Prisma } from '@prisma/client';
import { AnalyticsPagePreview } from '@/components/page-previews';
import { PendingButton } from '@/components/action-ui';

export const metadata = { title: 'Analytics' };

const RANGE_LABELS: Record<string, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

type SearchParams = { range?: string; from?: string; to?: string; account?: string; platform?: string };
const PERFORMANCE_SELECT = {
  id: true,
  platform: true,
  impressions: true,
  videoViews: true,
  reach: true,
  likes: true,
  comments: true,
  shares: true,
  saves: true,
  clicks: true,
  engagementRate: true,
  postPlatform: {
    select: {
      publishedAt: true,
      text: true,
      post: {
        select: {
          id: true,
          title: true,
          campaign: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.PostAnalyticsSelect;
type PerformanceRow = Prisma.PostAnalyticsGetPayload<{
  select: typeof PERFORMANCE_SELECT;
}>;

export default function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  return (
    <>
      <div><p className="b88-eyebrow">Measurement</p><h1 className="b88-page-title mt-3">Analytics</h1></div>
      <Suspense fallback={<AnalyticsPagePreview />}>
        <AnalyticsData params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function AnalyticsData({
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
      select: PERFORMANCE_SELECT,
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

  const timezone = ctx.workspace.timezone;
  const views = (row: { videoViews: number | null; impressions: number | null }) => row.videoViews ?? row.impressions;
  const totalViews = sumReported(postRows.map(views));
  const likes = postTotal(postRows, 'likes');
  const comments = postTotal(postRows, 'comments');
  const shares = postTotal(postRows, 'shares');
  const saves = postTotal(postRows, 'saves');

  // Followers per day across the selected accounts. A day an account was not
  // synced carries its last count forward, so a missed sync is not a dip.
  const lastKnown = new Map<string, number>();
  const followerDays = new Map<string, number>();
  for (const item of series) {
    if (item.followers !== null) lastKnown.set(item.socialAccountId, item.followers);
    followerDays.set(
      formatInZone(item.capturedOn, 'UTC', 'd LLL'),
      [...lastKnown.values()].reduce((sum, value) => sum + value, 0),
    );
  }
  const followerTrend = [...followerDays.entries()].map(([label, value]) => ({ label, value }));

  // Views by the day each post went out, across every day in the range.
  const viewsByDay = new Map<string, number>();
  for (const row of postRows) {
    const published = row.postPlatform.publishedAt;
    if (!published) continue;
    const key = formatInZone(published, timezone, 'yyyy-LL-dd');
    viewsByDay.set(key, (viewsByDay.get(key) ?? 0) + (views(row) ?? 0));
  }
  const dayBars: { label: string; value: number }[] = [];
  for (let day = new Date(range.from); day <= range.to && dayBars.length < 120; day = new Date(day.getTime() + 86_400_000)) {
    dayBars.push({
      label: formatInZone(day, timezone, 'd LLL'),
      value: viewsByDay.get(formatInZone(day, timezone, 'yyyy-LL-dd')) ?? 0,
    });
  }

  const hourBars = Array.from({ length: 24 }, (_, hour) => ({ label: String(hour).padStart(2, '0'), views: 0, posts: 0 }));
  for (const row of postRows) {
    const published = row.postPlatform.publishedAt;
    if (!published) continue;
    const slot = hourBars[Number(formatInZone(published, timezone, 'H'))];
    slot.views += views(row) ?? 0;
    slot.posts++;
  }

  const platformRows = [...byPlatform.entries()]
    .map(([platform, value]) => ({
      key: platform,
      label: PLATFORM_LABELS[platform],
      value: value.impressions,
      detail: `${value.posts} ${value.posts === 1 ? 'post' : 'posts'} · ${value.engagements.toLocaleString()} engagements`,
      colour: PLATFORM_COLOURS[platform],
    }))
    .sort((a, b) => b.value - a.value);
  const campaignRows = [...campaigns.entries()]
    .map(([key, value], index) => ({
      key,
      label: value.name,
      value: value.impressions,
      detail: `${value.posts} ${value.posts === 1 ? 'post' : 'posts'} · ${value.engagements.toLocaleString()} engagements`,
      colour: CHART_COLOURS[index % CHART_COLOURS.length],
    }))
    .sort((a, b) => b.value - a.value);
  const engagementSlices = [
    { label: 'Likes', value: likes ?? 0, colour: 'var(--block-pink)' },
    { label: 'Comments', value: comments ?? 0, colour: 'var(--block-lilac)' },
    { label: 'Shares', value: shares ?? 0, colour: 'var(--block-mint)' },
    { label: 'Saves', value: saves ?? 0, colour: 'var(--block-cream)' },
  ];
  const totalEngagements = engagementSlices.reduce((sum, slice) => sum + slice.value, 0);
  const selectedAccount = accounts.find((account) => account.id === filters.account);

  return (
    <div className="mt-6 min-h-[760px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <span />
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
      {postRows.length || snapshots.length ? (
        <>
          <section className="mt-8 rounded-[24px] bg-[var(--block-lime)] p-6 sm:p-10">
            <p className="b88-caption">
              {selectedAccount ? `${selectedAccount.accountName} · ${PLATFORM_LABELS[selectedAccount.platform]}` : 'All accounts'} · {RANGE_LABELS[range.preset] ?? `${formatInZone(range.from, timezone, 'd LLL')} to ${formatInZone(range.to, timezone, 'd LLL')}`}
            </p>
            <h2 className="mt-4 max-w-3xl text-[40px] font-[340] leading-[1.05] tracking-[-0.8px] sm:text-[56px] [text-wrap:balance]">
              {totalViews !== null ? `${short(totalViews)} views` : 'Views not reported'} across {postRows.length.toLocaleString()} {postRows.length === 1 ? 'post' : 'posts'}
            </h2>
            <dl className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
              <div><dt className="b88-caption">Followers</dt><dd className="mt-2 text-2xl font-[480] tabular-nums">{total('followers')?.toLocaleString() ?? 'Not reported'}</dd>{percentageChange(total('followers'), snapshotTotal(previous, 'followers')) && <dd className="b88-caption mt-1">{percentageChange(total('followers'), snapshotTotal(previous, 'followers'))} on the previous period</dd>}</div>
              <div><dt className="b88-caption">Follower growth</dt><dd className="mt-2 text-2xl font-[480] tabular-nums">{followerGrowth === null ? 'Not reported' : `${followerGrowth >= 0 ? '+' : ''}${followerGrowth.toLocaleString()}`}</dd></div>
              <div><dt className="b88-caption">Engagements</dt><dd className="mt-2 text-2xl font-[480] tabular-nums">{totalEngagements.toLocaleString()}</dd></div>
              <div><dt className="b88-caption">Engagement rate</dt><dd className="mt-2 text-2xl font-[480] tabular-nums">{engagementRate === null ? 'Not reported' : `${engagementRate.toFixed(1)}%`}</dd></div>
            </dl>
          </section>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricTile label="Views" value={totalViews} colour="var(--block-lilac)" detail={percentageChange(totalViews, sumReported(previousPostRows.map(views)))} />
            <MetricTile label="Likes" value={likes} colour="var(--block-pink)" detail={percentageChange(likes, postTotal(previousPostRows, 'likes'))} />
            <MetricTile label="Comments" value={comments} colour="var(--block-mint)" />
            <MetricTile label="Shares" value={shares} colour="var(--block-coral)" />
            <MetricTile label="Saves" value={saves} colour="var(--block-cream)" />
            <MetricTile label="Reach" value={total('reach')} colour="var(--block-lime)" />
            <MetricTile label="Clicks" value={postTotal(postRows, 'clicks')} colour="var(--surface-soft)" />
            <MetricTile label="Posts measured" value={postRows.length} colour="var(--surface-soft)" />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <ChartCard eyebrow="Audience" title="Followers over time">
              {followerTrend.length > 1
                ? <TrendChart points={followerTrend} colour="var(--block-mint)" label="Followers" />
                : <p>The trend appears after two days of follower counts. They are fetched daily.</p>}
            </ChartCard>
            <ChartCard eyebrow="Output" title="Views by publish day">
              {dayBars.some((bar) => bar.value > 0)
                ? <BarChart bars={dayBars} colour="var(--block-lilac)" label="Views by the day posts were published" every={Math.max(1, Math.ceil(dayBars.length / 6))} />
                : <p>No views were reported for posts in this period.</p>}
            </ChartCard>
            <ChartCard eyebrow="Engagement" title="What people did">
              {totalEngagements > 0
                ? <DonutChart slices={engagementSlices} centre={short(totalEngagements)} caption="engagements" />
                : <p>No likes, comments, shares or saves were reported in this period.</p>}
            </ChartCard>
            <ChartCard eyebrow="Comparison" title="Views by platform">
              {platformRows.length ? <RankBars rows={platformRows} /> : <p>No platform reported views in this period.</p>}
            </ChartCard>
            <ChartCard eyebrow="Publishing times" title={`Views by hour posted · ${timezone}`} className="xl:col-span-2">
              {hourBars.some((bar) => bar.views > 0)
                ? <BarChart bars={hourBars.map((bar) => ({ label: bar.label, value: bar.posts ? Math.round(bar.views / bar.posts) : 0 }))} colour="var(--block-coral)" label="Average views per post by hour published" every={3} />
                : <p>Published posts in this period do not have timing data yet.</p>}
              {bestTimes.length > 0 && (
                <p className="b88-caption mt-3">Average views per post, by the hour it went out</p>
              )}
            </ChartCard>
            {campaignRows.length > 0 && (
              <ChartCard eyebrow="Campaigns" title="Views by campaign" className="xl:col-span-2">
                <RankBars rows={campaignRows} />
              </ChartCard>
            )}
          </div>
          <PerformanceTable title="Top-performing posts" rows={topPosts} slug={slug} />
          <PerformanceTable title="Worst-performing posts" rows={worstPosts} slug={slug} />
        </>
      ) : (
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
    </div>
  );
}

function PerformanceTable({ title, rows, slug }: { title: string; rows: PerformanceRow[]; slug: string }) {
  return (
    <section className="b88-card mt-6 overflow-x-auto">
      <p className="b88-caption">Post analytics</p><h2 className="b88-heading mt-2 mb-5">{title}</h2>
      {rows.length ? (
        <table className="b88-table min-w-[760px] [&_:is(th,td):first-child]:pl-0 [&_:is(th,td):last-child]:pr-0">
          <thead><tr><th>Post</th><th>Platform</th><th>Views</th><th>Likes</th><th>Engagement</th><th>Action</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.id}>
              <td><Link className="font-[480]" href={`/w/${slug}/posts/${row.postPlatform.post.id}`}>{row.postPlatform.post.title ?? (row.postPlatform.text.slice(0, 60) || 'Untitled post')}</Link></td>
              <td>
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <span className="h-3 w-3 shrink-0 rounded-[3px] border border-[var(--ink)]" style={{ background: PLATFORM_COLOURS[row.platform] }} aria-hidden />
                  {PLATFORM_LABELS[row.platform]}
                </span>
              </td>
              <td className="tabular-nums">{metric(row.videoViews ?? row.impressions)}</td>
              <td className="tabular-nums">{metric(row.likes)}</td>
              <td className="tabular-nums">{row.engagementRate == null ? 'Not reported' : `${(row.engagementRate * 100).toFixed(1)}%`}</td>
              <td><Button href={`/w/${slug}/posts/${row.postPlatform.post.id}`} variant="tertiary">View analytics</Button></td>
            </tr>
          ))}</tbody>
        </table>
      ) : <p>No post-level analytics were reported in this period.</p>}
    </section>
  );
}

const metric = formatMetric;
