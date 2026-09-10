import Form from 'next/form';
import Link from 'next/link';
import { Badge, Button, EmptyState, Field, Select, StatusMessage } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { PLATFORM_LABELS, PLATFORMS } from '@/lib/social/registry';
import type { PostStatus } from '@prisma/client';
import { hasSearchCriteria, parseSearchFilters } from '@/lib/search/filters';
import { PostResultActions } from './result-actions';

// Every control on the filter rows has to match the Search pill at 40px. The
// kit field wrappers always carry b88-input, whose 48px floor outlives the
// height in b88-filter-control, so the floor is cleared alongside it.
const ROW_CONTROL = 'b88-filter-control min-h-10';

const STATUS_OPTIONS: [PostStatus, string][] = [
  ['DRAFT', 'Draft'],
  ['PENDING_APPROVAL', 'Pending approval'],
  ['APPROVED', 'Approved'],
  ['SCHEDULED', 'Scheduled'],
  ['PUBLISHING', 'Publishing'],
  ['PUBLISHED', 'Published'],
  ['FAILED', 'Failed'],
  ['CANCELLED', 'Cancelled'],
];

type SearchParams = {
  q?: string; type?: string; status?: string; platform?: string; account?: string;
  campaign?: string; author?: string; from?: string; to?: string; sort?: string;
};

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const raw = await searchParams;
  const filters = parseSearchFilters(raw);
  const q = filters.q;
  const ctx = await requireWorkspace(slug, 'workspace:view');
  const hasPostOnlyFilter = Boolean(filters.status || filters.account || filters.campaign || filters.author);
  const types = filters.type ? [filters.type] : hasPostOnlyFilter ? ['post'] : ['post', 'media', 'campaign', 'account'];
  const createdAt = {
    ...(filters.from ? { gte: filters.from } : {}),
    ...(filters.to ? { lte: filters.to } : {}),
  };
  const shouldSearch = hasSearchCriteria(filters) && !filters.error;
  const matchingPlatforms = q
    ? PLATFORMS.filter((platform) => PLATFORM_LABELS[platform].toLowerCase().includes(q.toLowerCase()))
    : [];
  const [filterAccounts, filterCampaigns, authors, posts, media, campaigns, accounts] = await Promise.all([
    db.socialAccount.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: { accountName: 'asc' }, select: { id: true, accountName: true, platform: true } }),
    db.campaign.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.workspaceMember.findMany({ where: { workspaceId: ctx.workspace.id }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { user: { email: 'asc' } } }),
    shouldSearch && types.includes('post') ? db.post.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.campaign ? { campaignId: filters.campaign } : {}),
        ...(filters.author ? { authorId: filters.author } : {}),
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
        ...(q ? { OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { campaign: { name: { contains: q, mode: 'insensitive' } } },
          { platforms: { some: { text: { contains: q, mode: 'insensitive' } } } },
          ...(matchingPlatforms.length ? [{ platforms: { some: { platform: { in: matchingPlatforms } } } }] : []),
        ] } : {}),
        ...((filters.platform || filters.account) ? { platforms: { some: {
          ...(filters.platform ? { platform: filters.platform } : {}),
          ...(filters.account ? { socialAccountId: filters.account } : {}),
        } } } : {}),
      },
      include: { campaign: true, platforms: { select: { platform: true, socialAccountId: true } } },
      orderBy: filters.sort === 'oldest' ? { createdAt: 'asc' } : filters.sort === 'title' ? { title: 'asc' } : { createdAt: 'desc' },
      take: 50,
    }) : [],
    shouldSearch && types.includes('media') ? db.mediaAsset.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        ...(q ? { OR: [{ filename: { contains: q, mode: 'insensitive' } }, { altText: { contains: q, mode: 'insensitive' } }] } : {}),
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
      },
      orderBy: { createdAt: filters.sort === 'oldest' ? 'asc' : 'desc' },
      take: 50,
    }) : [],
    shouldSearch && types.includes('campaign') ? db.campaign.findMany({
      where: { workspaceId: ctx.workspace.id, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}), ...(Object.keys(createdAt).length ? { createdAt } : {}) },
      orderBy: filters.sort === 'oldest' ? { createdAt: 'asc' } : filters.sort === 'title' ? { name: 'asc' } : { createdAt: 'desc' },
      take: 50,
    }) : [],
    shouldSearch && types.includes('account') ? db.socialAccount.findMany({
      where: { workspaceId: ctx.workspace.id, ...(q ? { OR: [{ accountName: { contains: q, mode: 'insensitive' } }, { accountHandle: { contains: q, mode: 'insensitive' } }] } : {}), ...(filters.platform ? { platform: filters.platform } : {}), ...(Object.keys(createdAt).length ? { createdAt } : {}) },
      orderBy: { createdAt: filters.sort === 'oldest' ? 'asc' : 'desc' },
      take: 50,
    }) : [],
  ]);
  const results = [
    ...posts.map((item) => ({ id: item.id, type: 'Post' as const, label: item.title ?? 'Untitled post', meta: [item.status.replaceAll('_', ' ').toLowerCase(), item.campaign?.name].filter(Boolean).join(' · '), href: `/w/${slug}/posts/${item.id}` })),
    ...media.map((item) => ({ id: item.id, type: 'Media' as const, label: item.filename, meta: `${item.type.toLowerCase()} · ${(item.size / 1024 / 1024).toFixed(1)} MB`, href: `/w/${slug}/media?asset=${item.id}` })),
    ...campaigns.map((item) => ({ id: item.id, type: 'Campaign' as const, label: item.name, meta: item.status.toLowerCase(), href: `/w/${slug}/campaigns?campaign=${item.id}` })),
    ...accounts.map((item) => ({ id: item.id, type: 'Account' as const, label: item.accountName, meta: PLATFORM_LABELS[item.platform], href: `/w/${slug}/channels?account=${item.id}` })),
  ];
  return (
    <>
      <p className="b88-eyebrow">Workspace search</p><h1 className="b88-page-title mt-3">Find anything</h1>
      {/* next/form keeps the GET filter submit a client-side navigation, which a
          plain <form> cannot do without a client component. */}
      <Form action={`/w/${slug}/search`} className="mt-8 grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="workspace-search" name="q" label="Search posts, media, campaigns and accounts" defaultValue={q} autoFocus containerClassName="sm:col-span-2 lg:col-span-3" />
        <Select name="type" label="Type" className={ROW_CONTROL} defaultValue={raw.type ?? ''}><option value="">All</option><option value="post">Posts</option><option value="media">Media</option><option value="campaign">Campaigns</option><option value="account">Accounts</option></Select>
        <Button type="submit" className="self-end">Search</Button>
        {hasSearchCriteria(filters) && <Button href={`/w/${slug}/search`} variant="tertiary" className="self-end">Clear filters</Button>}
        <details
          className="rounded-md border border-hairline p-4 sm:col-span-2 lg:col-span-3"
          open={Boolean(raw.status || raw.platform || raw.account || raw.campaign || raw.author || raw.from || raw.to || raw.sort)}
        >
          <summary className="cursor-pointer font-[480]">Advanced filters</summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select name="status" label="Post status" className={ROW_CONTROL} defaultValue={raw.status ?? ''}><option value="">Any</option>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
            <Select name="platform" label="Platform" className={ROW_CONTROL} defaultValue={raw.platform ?? ''}><option value="">Any</option>{PLATFORMS.map((platform) => <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}</option>)}</Select>
            <Select name="account" label="Account" className={ROW_CONTROL} defaultValue={raw.account ?? ''}><option value="">Any</option>{filterAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountName} · {PLATFORM_LABELS[account.platform]}</option>)}</Select>
            <Select name="campaign" label="Campaign" className={ROW_CONTROL} defaultValue={raw.campaign ?? ''}><option value="">Any</option>{filterCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</Select>
            <Select name="author" label="Author" className={ROW_CONTROL} defaultValue={raw.author ?? ''}><option value="">Any</option>{authors.map(({ user }) => <option key={user.id} value={user.id}>{user.name ?? user.email}</option>)}</Select>
            <Field name="from" label="Created after" type="date" className={ROW_CONTROL} defaultValue={raw.from ?? ''} />
            <Field name="to" label="Created before" type="date" className={ROW_CONTROL} defaultValue={raw.to ?? ''} />
            <Select name="sort" label="Sort" className={ROW_CONTROL} defaultValue={filters.sort}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option></Select>
          </div>
        </details>
      </Form>
      {filters.error && <StatusMessage tone="error" className="mt-4 max-w-5xl">{filters.error}</StatusMessage>}
      {results.length ? (
        <section className="b88-card mt-6 max-w-5xl">
          <div className="flex items-center justify-between gap-3"><p className="b88-caption">{results.length} results</p><p className="text-sm">Every result includes its next action.</p></div>
          <div className="mt-3">
          {results.map((result) => <article key={`${result.type}-${result.id}`} className="flex flex-col gap-3 border-t border-hairline-soft py-4 sm:flex-row sm:items-center">
            <Badge tone="outline">{result.type}</Badge>
            <div className="min-w-0 flex-1"><Link href={result.href} className="font-[480] transition-opacity hover:opacity-80">{result.label}</Link><p className="b88-caption mt-1 capitalize">{result.meta}</p></div>
            {result.type === 'Post'
              ? <PostResultActions slug={slug} postId={result.id} canEdit={ctx.can('post:update')} canDelete={ctx.can('post:delete')} />
              : <Button href={result.href} variant="tertiary">Open {result.type.toLowerCase()}</Button>}
          </article>)}
          </div>
        </section>
      ) : (
        <div className="mt-6 max-w-5xl">
          <EmptyState eyebrow={shouldSearch ? 'No matches' : 'Nothing searched yet'} title={shouldSearch ? 'No matching workspace items' : 'Enter a search term or choose a filter'}>
            {shouldSearch
              ? 'Use the focused search field above to try a shorter term, clear a filter, or widen the date range.'
              : 'The search field above is focused and ready. Search post copy, titles, campaigns, platforms, media and connected accounts.'}
          </EmptyState>
        </div>
      )}
    </>
  );
}
