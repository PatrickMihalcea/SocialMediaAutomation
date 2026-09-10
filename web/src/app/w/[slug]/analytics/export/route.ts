import { NextRequest, NextResponse } from 'next/server';
import type { Platform } from '@prisma/client';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { resolveAnalyticsRange } from '@/lib/analytics/range';
import { PLATFORM_LABELS } from '@/lib/social/registry';

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'analytics:view');
  const search = request.nextUrl.searchParams;
  const filters = {
    range: search.get('range') ?? undefined,
    from: search.get('from') ?? undefined,
    to: search.get('to') ?? undefined,
  };
  const range = resolveAnalyticsRange(filters);
  if (range.error) {
    return NextResponse.json({ error: range.error }, { status: 400 });
  }
  const platform = search.get('platform') || undefined;
  const account = search.get('account') || undefined;
  const rows = await db.postAnalytics.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      fetchedAt: { gte: range.from, lte: range.to },
      ...(platform ? { platform: platform as Platform } : {}),
      ...(account ? { postPlatform: { socialAccountId: account } } : {}),
    },
    include: { postPlatform: { include: { post: true, socialAccount: true } } },
    orderBy: { fetchedAt: 'desc' },
  });
  const csv = [
    ['Post', 'Account', 'Platform', 'Impressions', 'Reach', 'Likes', 'Comments', 'Shares', 'Saves', 'Clicks', 'Engagement rate', 'Fetched at'],
    ...rows.map((row) => [
      row.postPlatform.post.title ?? 'Untitled post',
      row.postPlatform.socialAccount.accountName,
      PLATFORM_LABELS[row.platform],
      row.impressions, row.reach, row.likes, row.comments, row.shares, row.saves, row.clicks,
      row.engagementRate === null ? null : `${(row.engagementRate * 100).toFixed(1)}%`,
      row.fetchedAt.toISOString(),
    ]),
  ].map((row) => row.map(csvCell).join(',')).join('\n');

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="bridge88-${slug}-analytics.csv"`,
    },
  });
}

function csvCell(value: string | number | null) {
  if (value === null) return '';
  return `"${String(value).replaceAll('"', '""')}"`;
}
