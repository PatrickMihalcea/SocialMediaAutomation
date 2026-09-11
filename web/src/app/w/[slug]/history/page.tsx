import { Suspense } from 'react';
import Form from 'next/form';
import Link from 'next/link';
import { Badge, Button, EmptyState, Field, Select, StatusMessage } from '@/bridge88/components';
import { humanizeMachineValue } from '@/bridge88/humanize';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import {
  buildAuditWhere,
  formatAuditTimestamp,
  historyTypeLabel,
  humanizeAuditEvent,
  parseHistoryFilters,
} from '@/lib/audit-view';
import { HistoryPagePreview } from '@/components/page-previews';
import { timezoneLabel } from '@/lib/scheduling/time';

const PAGE_SIZE = 10;

export const metadata = { title: 'History' };

type SearchParams = {
  type?: string;
  from?: string;
  to?: string;
  post?: string;
  page?: string;
};

type EntityDestination = {
  label: string;
  href?: string;
  deleted?: boolean;
};

const CONTROL_CLASS = 'b88-filter-control h-10 min-h-10';

export default function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  return (
    <>
      <p className="b88-eyebrow">Workspace activity</p>
      <h1 className="b88-page-title mt-3">History</h1>
      <Suspense fallback={<HistoryPagePreview />}>
        <HistoryData params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function HistoryData({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspace(slug, 'workspace:view');
  if (!ctx.can('post:update')) {
    return (
      <div className="min-h-[360px]">
        <StatusMessage tone="neutral" className="mt-6 max-w-2xl">
          Viewers can read workspace content, but audit history is limited to members who can edit posts.
        </StatusMessage>
        <Button href={`/w/${slug}`} variant="secondary" className="mt-5">Return to dashboard</Button>
      </div>
    );
  }
  const filters = parseHistoryFilters(raw, ctx.workspace.timezone);

  const [postPlatformIds, approvalIds] = filters.postId
    ? await Promise.all([
      db.postPlatform.findMany({
        where: { workspaceId: ctx.workspace.id, postId: filters.postId },
        select: { id: true },
      }),
      db.approvalComment.findMany({
        where: { workspaceId: ctx.workspace.id, postId: filters.postId },
        select: { id: true },
      }),
    ])
    : [[], []];

  const where = buildAuditWhere(
    ctx.workspace.id,
    filters,
    postPlatformIds.map(({ id }) => id),
    approvalIds.map(({ id }) => id),
  );
  const total = await db.auditLog.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);
  const audits = await db.auditLog.findMany({
    where,
    include: { user: { select: { name: true, email: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const destinations = await resolveDestinations(
    slug,
    ctx.workspace.id,
    ctx.workspace.name,
    audits.map((audit) => ({ entityType: audit.entityType, entityId: audit.entityId })),
  );

  const filtered = Boolean(raw.type || raw.from || raw.to || raw.post);
  const firstResult = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastResult = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mt-6 min-h-[460px] max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="b88-caption">Workspace · {timezoneLabel(ctx.workspace.timezone)}</p>
        {filters.postId && <Button href={`/w/${slug}/posts/${filters.postId}`} variant="secondary">Open post</Button>}
      </div>

      <Form
        action={`/w/${slug}/history`}
        className="mt-6 grid max-w-5xl grid-cols-[minmax(0,1fr)] items-end gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {filters.postId && <input type="hidden" name="post" value={filters.postId} />}
        <Select name="type" label="Activity type" className={CONTROL_CLASS} defaultValue={filters.type ?? ''}>
          <option value="">All activity</option>
          <option value="post">Posts and publishing</option>
          <option value="campaign">Campaigns</option>
          <option value="account">Social accounts</option>
          <option value="approval">Approvals</option>
          <option value="media">Media</option>
          <option value="workspace">Workspace settings</option>
        </Select>
        <Field name="from" label="From date" type="date" className={CONTROL_CLASS} defaultValue={raw.from ?? ''} />
        <Field name="to" label="To date" type="date" className={CONTROL_CLASS} defaultValue={raw.to ?? ''} />
        <Button type="submit">Apply filters</Button>
      </Form>

      {filters.error && (
        <StatusMessage tone="error" className="mt-4 max-w-5xl">
          {filters.error} Valid filters were still applied.
        </StatusMessage>
      )}
      {filtered && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button href={`/w/${slug}/history`} variant="tertiary">Clear filters</Button>
          {filters.postId && <Badge tone="lilac">Post timeline</Badge>}
        </div>
      )}

      {audits.length ? (
        <section className="b88-card mt-5 max-w-5xl" aria-label="Workspace activity">
          <p className="b88-caption">Showing {firstResult}–{lastResult} of {total} events</p>
          <ol className="mt-3">
            {audits.map((audit) => {
              const key = `${audit.entityType}:${audit.entityId ?? ''}`;
              const destination = destinations.get(key) ?? fallbackDestination(slug, ctx.workspace.name, audit.entityType, audit.entityId);
              const actor = audit.user?.name?.trim() || audit.user?.email || 'Bridge88';
              const sentence = humanizeAuditEvent({
                action: audit.action,
                actor,
                entity: destination.label,
                metadata: audit.metadata,
              });
              return (
                <li
                  key={audit.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-hairline-soft py-3 first:border-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start"
                >
                  <Badge tone={badgeTone(audit.entityType)}>{historyTypeLabel(audit.entityType)}</Badge>
                  <div className="min-w-0">
                    {destination.href ? (
                      <Link href={destination.href} className="font-[480] leading-snug transition-opacity hover:opacity-80">
                        {sentence}
                      </Link>
                    ) : (
                      <p className="font-[480] leading-snug">{sentence}</p>
                    )}
                    {destination.deleted && <p className="mt-1 text-sm">The original item was deleted, so this event has no destination.</p>}
                  </div>
                  <time className="b88-caption col-start-2 whitespace-nowrap sm:col-start-3 sm:row-start-1" dateTime={audit.createdAt.toISOString()}>
                    {formatAuditTimestamp(audit.createdAt, ctx.workspace.timezone)}
                  </time>
                </li>
              );
            })}
          </ol>
          {totalPages > 1 && (
            <nav className="mt-4 flex items-center justify-between gap-3 border-t border-hairline-soft pt-4" aria-label="History pages">
              {page > 1
                ? <Button href={pageHref(slug, raw, page - 1)} variant="secondary">Previous</Button>
                : <span />}
              <p className="b88-caption">Page {page} of {totalPages}</p>
              {page < totalPages
                ? <Button href={pageHref(slug, raw, page + 1)} variant="secondary">Next</Button>
                : <span />}
            </nav>
          )}
        </section>
      ) : (
        <div className="mt-5 max-w-5xl">
          <EmptyState
            eyebrow={filtered ? 'No matching events' : 'No history yet'}
            title={filtered ? 'Nothing happened in this range' : 'Workspace activity will appear here'}
            action={filtered
              ? <Button href={`/w/${slug}/history`} variant="secondary">Clear filters</Button>
              : <Button href={`/w/${slug}/compose`}>Create a post</Button>}
          >
            {filtered ? 'Try broader filters.' : undefined}
          </EmptyState>
        </div>
      )}
    </div>
  );
}

async function resolveDestinations(
  slug: string,
  workspaceId: string,
  workspaceName: string,
  references: { entityType: string; entityId: string | null }[],
): Promise<Map<string, EntityDestination>> {
  const ids = (type: string) => references
    .filter((reference) => reference.entityType === type && reference.entityId)
    .map((reference) => reference.entityId as string);
  const approvalEntityIds = [...ids('approval'), ...ids('approval_comment')];
  const possiblePostIds = [...ids('post'), ...approvalEntityIds];

  const [posts, platforms, campaigns, accounts, media, approvals] = await Promise.all([
    db.post.findMany({
      where: { workspaceId, id: { in: possiblePostIds } },
      select: { id: true, title: true },
    }),
    db.postPlatform.findMany({
      where: { workspaceId, id: { in: ids('post_platform') } },
      select: { id: true, platform: true, post: { select: { id: true, title: true } } },
    }),
    db.campaign.findMany({
      where: { workspaceId, id: { in: ids('campaign') } },
      select: { id: true, name: true },
    }),
    db.socialAccount.findMany({
      where: { workspaceId, id: { in: ids('social_account') } },
      select: { id: true, accountName: true },
    }),
    db.mediaAsset.findMany({
      where: { workspaceId, id: { in: ids('media_asset') } },
      select: { id: true, filename: true },
    }),
    db.approvalComment.findMany({
      where: { workspaceId, id: { in: approvalEntityIds } },
      select: { id: true, post: { select: { id: true, title: true } } },
    }),
  ]);

  const result = new Map<string, EntityDestination>();
  for (const post of posts) result.set(`post:${post.id}`, postDestination(slug, post));
  for (const platform of platforms) {
    result.set(`post_platform:${platform.id}`, postDestination(slug, platform.post));
  }
  for (const campaign of campaigns) {
    result.set(`campaign:${campaign.id}`, {
      label: `the campaign “${campaign.name}”`,
      href: `/w/${slug}/campaigns/${campaign.id}`,
    });
  }
  for (const account of accounts) {
    result.set(`social_account:${account.id}`, {
      label: `the social account “${account.accountName}”`,
      href: `/w/${slug}/channels?account=${encodeURIComponent(account.id)}`,
    });
  }
  for (const asset of media) {
    result.set(`media_asset:${asset.id}`, {
      label: `the media asset “${humanizeMachineValue(asset.filename)}”`,
      href: `/w/${slug}/media?asset=${encodeURIComponent(asset.id)}`,
    });
  }
  for (const approval of approvals) {
    const destination = postDestination(slug, approval.post);
    result.set(`approval:${approval.id}`, destination);
    result.set(`approval_comment:${approval.id}`, destination);
  }
  for (const post of posts) {
    for (const type of ['approval', 'approval_comment']) {
      result.set(`${type}:${post.id}`, postDestination(slug, post));
    }
  }
  for (const reference of references) {
    if (reference.entityType === 'workspace' || reference.entityType === 'brand_settings') {
      result.set(`${reference.entityType}:${reference.entityId ?? ''}`, {
        label: `the workspace “${workspaceName}”`,
        href: `/w/${slug}/settings`,
      });
    }
    if (reference.entityType === 'oauth_attempt') {
      result.set(`oauth_attempt:${reference.entityId ?? ''}`, {
        label: 'a social account connection',
        href: `/w/${slug}/channels`,
      });
    }
  }
  return result;
}

function postDestination(slug: string, post: { id: string; title: string | null }): EntityDestination {
  return {
    label: `the post “${post.title?.trim() || 'Untitled post'}”`,
    href: `/w/${slug}/posts/${post.id}`,
  };
}

function fallbackDestination(
  slug: string,
  workspaceName: string,
  entityType: string,
  entityId: string | null,
): EntityDestination {
  if (!entityId) return { label: `the workspace “${workspaceName}”`, href: `/w/${slug}/settings` };
  const names: Record<string, string> = {
    post: 'the deleted post',
    post_platform: 'the deleted post',
    campaign: 'the deleted campaign',
    social_account: 'the deleted social account',
    approval: 'the deleted approval',
    approval_comment: 'the deleted approval',
    media_asset: 'the deleted media file',
  };
  return { label: names[entityType] ?? 'a deleted workspace item', deleted: true };
}

function badgeTone(entityType: string): 'outline' | 'cream' | 'lilac' | 'mint' | 'neutral' {
  if (entityType === 'post' || entityType === 'post_platform') return 'outline';
  if (entityType === 'campaign') return 'cream';
  if (entityType === 'social_account' || entityType === 'oauth_attempt') return 'mint';
  if (entityType === 'approval' || entityType === 'approval_comment') return 'lilac';
  return 'neutral';
}

function pageHref(slug: string, raw: SearchParams, page: number): string {
  const query = new URLSearchParams();
  for (const key of ['type', 'from', 'to', 'post'] as const) {
    if (raw[key]) query.set(key, raw[key] as string);
  }
  query.set('page', String(page));
  return `/w/${slug}/history?${query.toString()}`;
}
