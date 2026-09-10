import Form from 'next/form';
import Link from 'next/link';
import { Badge, Button, EmptyState, Field, Select } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { PLATFORM_LABELS, PLATFORMS } from '@/lib/social/registry';
import type { Platform, PostStatus } from '@prisma/client';

// Every control on the filter rows has to match the Search pill at 40px. The
// kit field wrappers always carry b88-input, whose 48px floor outlives the
// height in b88-filter-control, so the floor is cleared alongside it.
const ROW_CONTROL = 'b88-filter-control min-h-10';

const STATUS_OPTIONS: [PostStatus, string][] = [
  ['DRAFT', 'Draft'],
  ['SCHEDULED', 'Scheduled'],
  ['PUBLISHED', 'Published'],
  ['FAILED', 'Failed'],
];

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; type?: string; status?: string; platform?: string; from?: string; to?: string }>;
}) {
  const { slug } = await params;
  const filters = await searchParams;
  const q = filters.q?.trim() ?? '';
  const ctx = await requireWorkspace(slug, 'workspace:view');
  const types = filters.type ? [filters.type] : ['post', 'media', 'campaign', 'account'];
  const createdAt = {
    ...(filters.from ? { gte: new Date(filters.from) } : {}),
    ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999Z`) } : {}),
  };
  const [posts, media, campaigns, accounts] = q ? await Promise.all([
    types.includes('post') ? db.post.findMany({ where: { workspaceId: ctx.workspace.id, ...(filters.status ? { status: filters.status as PostStatus } : {}), ...(Object.keys(createdAt).length ? { createdAt } : {}), OR: [{ title: { contains: q, mode: 'insensitive' } }, { platforms: { some: { text: { contains: q, mode: 'insensitive' }, ...(filters.platform ? { platform: filters.platform as Platform } : {}) } } }] }, take: 20 }) : [],
    types.includes('media') ? db.mediaAsset.findMany({ where: { workspaceId: ctx.workspace.id, filename: { contains: q, mode: 'insensitive' }, ...(Object.keys(createdAt).length ? { createdAt } : {}) }, take: 20 }) : [],
    types.includes('campaign') ? db.campaign.findMany({ where: { workspaceId: ctx.workspace.id, name: { contains: q, mode: 'insensitive' }, ...(Object.keys(createdAt).length ? { createdAt } : {}) }, take: 20 }) : [],
    types.includes('account') ? db.socialAccount.findMany({ where: { workspaceId: ctx.workspace.id, accountName: { contains: q, mode: 'insensitive' }, ...(filters.platform ? { platform: filters.platform as Platform } : {}), ...(Object.keys(createdAt).length ? { createdAt } : {}) }, take: 20 }) : [],
  ]) : [[], [], [], []];
  const results = [
    ...posts.map((item) => ({ id: item.id, type: 'Post', label: item.title ?? 'Untitled post', href: `/w/${slug}/calendar?post=${item.id}` })),
    ...media.map((item) => ({ id: item.id, type: 'Media', label: item.filename, href: `/w/${slug}/media` })),
    ...campaigns.map((item) => ({ id: item.id, type: 'Campaign', label: item.name, href: `/w/${slug}/campaigns` })),
    ...accounts.map((item) => ({ id: item.id, type: 'Account', label: item.accountName, href: `/w/${slug}/channels` })),
  ];
  return (
    <>
      <p className="b88-eyebrow">Workspace search</p><h1 className="b88-page-title mt-3">Find anything</h1>
      {/* next/form keeps the GET filter submit a client-side navigation, which a
          plain <form> cannot do without a client component. */}
      <Form action={`/w/${slug}/search`} className="mt-8 grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field name="q" label="Search posts, media, campaigns and accounts" defaultValue={q} autoFocus containerClassName="sm:col-span-2 lg:col-span-3" />
        <Select name="type" label="Type" className={ROW_CONTROL} defaultValue={filters.type ?? ''}><option value="">All</option><option value="post">Posts</option><option value="media">Media</option><option value="campaign">Campaigns</option><option value="account">Accounts</option></Select>
        <Select name="status" label="Post status" className={ROW_CONTROL} defaultValue={filters.status ?? ''}><option value="">Any</option>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
        <Select name="platform" label="Platform" className={ROW_CONTROL} defaultValue={filters.platform ?? ''}><option value="">Any</option>{PLATFORMS.map((platform) => <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}</option>)}</Select>
        <Field name="from" label="Created after" type="date" className={ROW_CONTROL} defaultValue={filters.from ?? ''} /><Field name="to" label="Created before" type="date" className={ROW_CONTROL} defaultValue={filters.to ?? ''} />
        <Button type="submit" className="self-end">Search</Button>
      </Form>
      {results.length ? (
        <section className="b88-card mt-6">
          {results.map((result) => <Link key={`${result.type}-${result.id}`} href={result.href} className="flex flex-wrap items-center gap-4 border-t border-hairline-soft py-4 transition-opacity first:border-0 hover:opacity-80"><Badge tone="outline">{result.type}</Badge><p className="font-[480]">{result.label}</p></Link>)}
        </section>
      ) : (
        <div className="mt-6">
          <EmptyState eyebrow={q ? 'No matches' : 'Nothing searched yet'} title={q ? 'No matching workspace items' : 'Enter a search term'}>
            {q ? 'Try a shorter term, or widen the type, status and date filters.' : 'Search posts, media, campaigns and connected accounts in this workspace.'}
          </EmptyState>
        </div>
      )}
    </>
  );
}
