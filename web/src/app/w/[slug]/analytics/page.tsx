import { Badge, Button, EmptyState, StatCard } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { formatMetric, sumReported, type NullableMetric } from '@/lib/analytics/aggregate';
import { refreshAnalyticsAction } from '@/app/actions/analytics';

/**
 * StatCard sets its value at 38px, which reads as a headline for the
 * "Not reported" sentence a null metric carries. The wrapper drops that one
 * string to body size instead of forking the component.
 */
function Metric({ label, value }: { label: string; value: NullableMetric }) {
  return (
    <div className={value === null ? '[&_p+p]:text-[15px] [&_p+p]:font-[330] [&_p+p]:leading-normal' : ''}>
      <StatCard label={label} value={formatMetric(value)} />
    </div>
  );
}

export default async function AnalyticsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'analytics:view');
  const [snapshots, topPosts] = await Promise.all([
    db.analyticsSnapshot.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { capturedOn: 'desc' },
      take: 90,
    }),
    db.postAnalytics.findMany({
      where: { workspaceId: ctx.workspace.id },
      include: { postPlatform: { include: { post: true, socialAccount: true } } },
      orderBy: { impressions: 'desc' },
      take: 10,
    }),
  ]);
  const latest = new Map<string, (typeof snapshots)[number]>();
  for (const item of snapshots) if (!latest.has(item.socialAccountId)) latest.set(item.socialAccountId, item);
  const current = [...latest.values()];
  const total = (field: 'followers' | 'impressions' | 'reach' | 'engagements') =>
    sumReported(current.map((item) => item[field]));
  const series = [...snapshots].reverse().slice(-30);
  const chartValues = series.map((item) => item.reach).filter((value): value is number => value !== null);
  const maxReach = Math.max(...chartValues, 1);
  const points = series.map((item, index) => {
    if (item.reach === null) return null;
    const x = series.length <= 1 ? 0 : (index / (series.length - 1)) * 600;
    return `${x},${160 - (item.reach / maxReach) * 150}`;
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="b88-eyebrow">Measurement</p><h1 className="b88-page-title mt-3">Analytics</h1></div>
        <form action={refreshAnalyticsAction.bind(null, slug)}><Button type="submit" variant="secondary">Refresh analytics</Button></form>
      </div>
      <p className="mt-4 max-w-2xl">Null metrics remain “not reported.” Bridge88 never turns a platform omission into a zero.</p>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Followers" value={total('followers')} />
        <Metric label="Impressions" value={total('impressions')} />
        <Metric label="Reach" value={total('reach')} />
        <Metric label="Engagements" value={total('engagements')} />
      </div>
      <section className="b88-card mt-6">
        <p className="b88-caption">Last 30 measurements</p><h2 className="b88-heading mt-2">Reported reach</h2>
        {chartValues.length ? <svg className="mt-5 h-44 w-full" viewBox="0 0 600 170" role="img" aria-label="Reported reach trend">
          <polyline points={points.filter(Boolean).join(' ')} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </svg> : <p className="mt-5 rounded-md bg-surface-soft p-5">Reach is not reported yet.</p>}
      </section>
      <section className="b88-card mt-6 overflow-x-auto">
        <p className="b88-caption">Top posts</p><h2 className="b88-heading mt-2 mb-5">Performance</h2>
        {topPosts.length ? (
          <table className="b88-table min-w-[700px] [&_:is(th,td):first-child]:pl-0 [&_:is(th,td):last-child]:pr-0">
            <thead><tr><th>Post</th><th>Platform</th><th>Impressions</th><th>Engagement</th><th>Clicks</th></tr></thead>
            <tbody>{topPosts.map((row) => (
              <tr key={row.id}>
                <td><a className="font-[480]" href={`/w/${slug}/posts/${row.postPlatform.post.id}`}>{row.postPlatform.post.title ?? row.postPlatform.text.slice(0, 60)}</a></td>
                <td><Badge tone="outline">{PLATFORM_LABELS[row.platform]}</Badge></td>
                <td>{metric(row.impressions)}</td><td>{row.engagementRate == null ? 'Not reported' : `${(row.engagementRate * 100).toFixed(1)}%`}</td><td>{metric(row.clicks)}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : (
          <EmptyState
            eyebrow="No measurements"
            title="Analytics arrive after publishing"
            action={<Button href={`/w/${slug}/compose`}>Create post</Button>}
          >
            The worker schedules a first synchronization one hour after a post goes live.
          </EmptyState>
        )}
      </section>
    </>
  );
}

const metric = formatMetric;
