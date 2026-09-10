import Link from 'next/link';
import { Badge, EmptyState, StatCard, StatusMessage } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { formatMetric } from '@/lib/analytics/aggregate';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { notFound } from 'next/navigation';

export default async function PostAnalyticsPage({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug, postId } = await params;
  const ctx = await requireWorkspace(slug, 'analytics:view');
  const post = await db.post.findFirst({
    where: { id: postId, workspaceId: ctx.workspace.id },
    include: {
      platforms: {
        include: { analytics: true, socialAccount: { select: { accountName: true } } },
      },
    },
  });
  if (!post) notFound();
  return (
    <>
      <Link href={`/w/${slug}/analytics`} className="font-[480]">Back to analytics</Link>
      <p className="b88-eyebrow mt-8">Post analytics</p>
      <h1 className="b88-page-title mt-3">{post.title ?? 'Untitled post'}</h1>
      {post.status === 'PUBLISHED' && (
        <StatusMessage tone="success" className="mt-6">
          Published via a simulated integration.
        </StatusMessage>
      )}
      <div className="mt-8 space-y-6">
        {post.platforms.map((channel) => channel.analytics ? (
          <section key={channel.id} className="b88-card">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="b88-heading">{channel.socialAccount.accountName}</h2><p className="b88-caption mt-2">Updated {channel.analytics.fetchedAt.toLocaleString()}</p></div>
              <Badge tone="outline">{PLATFORM_LABELS[channel.platform]}</Badge>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Impressions" value={formatMetric(channel.analytics.impressions)} />
              <StatCard label="Reach" value={formatMetric(channel.analytics.reach)} />
              <StatCard label="Likes" value={formatMetric(channel.analytics.likes)} />
              <StatCard label="Comments" value={formatMetric(channel.analytics.comments)} />
              <StatCard label="Shares" value={formatMetric(channel.analytics.shares)} />
              <StatCard label="Saves" value={formatMetric(channel.analytics.saves)} />
              <StatCard label="Clicks" value={formatMetric(channel.analytics.clicks)} />
              <StatCard label="Video views" value={formatMetric(channel.analytics.videoViews)} />
            </div>
          </section>
        ) : <EmptyState key={channel.id} eyebrow={PLATFORM_LABELS[channel.platform]} title="Analytics not available">This channel has not reported post metrics yet.</EmptyState>)}
      </div>
    </>
  );
}
