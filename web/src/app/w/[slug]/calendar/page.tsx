import { Platform, PostStatus } from '@prisma/client';
import { Button } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { formatInZone } from '@/lib/scheduling/time';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { CalendarShell, type CalendarPost } from '@/components/calendar-shell';

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    status?: string; platform?: string; campaign?: string; account?: string;
    view?: string; date?: string; post?: string;
  }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await requireWorkspace(slug, 'post:view');
  const status = Object.values(PostStatus).includes(query.status as PostStatus)
    ? query.status as PostStatus
    : undefined;
  const platform = Object.values(Platform).includes(query.platform as Platform)
    ? query.platform as Platform
    : undefined;
  const campaign = isUuid(query.campaign) ? query.campaign : undefined;
  const account = isUuid(query.account) ? query.account : undefined;
  const [posts, campaigns, accounts] = await Promise.all([db.post.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      ...(status ? { status } : {}),
      ...(campaign ? { campaignId: campaign } : {}),
      ...((platform || account) ? { platforms: { some: {
        ...(platform ? { platform } : {}),
        ...(account ? { socialAccountId: account } : {}),
      } } } : {}),
    },
    include: {
      campaign: true,
      platforms: {
        include: {
          socialAccount: { select: { accountName: true } },
        },
      },
    },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
    take: 300,
  }), db.campaign.findMany({
    where: { workspaceId: ctx.workspace.id },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  }), db.socialAccount.findMany({
    where: { workspaceId: ctx.workspace.id },
    select: { id: true, accountName: true, platform: true },
    orderBy: { accountName: 'asc' },
  })]);

  const serialized: CalendarPost[] = posts.map((post) => ({
    id: post.id,
    title: post.title ?? post.platforms[0]?.text.slice(0, 70) ?? 'Untitled post',
    text: post.platforms[0]?.text ?? '',
    status: post.status,
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
    campaign: post.campaign?.name ?? null,
    platforms: [...new Set(post.platforms.map((platform) => PLATFORM_LABELS[platform.platform]))],
    accounts: [...new Set(post.platforms.map((platform) => platform.socialAccount.accountName))],
  }));
  const selectedPost = serialized.find((post) => post.id === query.post);
  const view = ['month', 'week', 'list'].includes(query.view ?? '') ? query.view as 'month' | 'week' | 'list' : 'month';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(query.date ?? '') ? query.date! : formatInZone(new Date(), ctx.workspace.timezone, 'yyyy-MM-dd');
  const filters = Object.fromEntries(Object.entries({
    status, platform, campaign, account,
  }).filter((entry): entry is [string, string] => Boolean(entry[1])));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="b88-eyebrow">Calendar · {ctx.workspace.timezone}</p>
          <h1 className="b88-page-title mt-3">Content calendar</h1>
        </div>
        <Button href={`/w/${slug}/compose`}>Create post</Button>
      </div>
      <CalendarShell
        slug={slug}
        timezone={ctx.workspace.timezone}
        posts={serialized}
        view={view}
        anchor={anchor}
        selectedPost={selectedPost}
        filters={filters}
        platformOptions={[...new Map(accounts.map((account) => [account.platform, { value: account.platform, label: PLATFORM_LABELS[account.platform] }])).values()]}
        accountOptions={accounts.map((account) => ({ value: account.id, label: account.accountName }))}
        campaignOptions={campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name }))}
        canDelete={ctx.can('post:delete')}
      />
    </>
  );
}

function isUuid(value?: string): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
