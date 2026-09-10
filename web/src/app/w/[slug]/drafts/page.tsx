import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge, Button, EmptyState } from '@/bridge88/components';
import { StatusGlyph } from '@/components/visuals';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { formatInZone } from '@/lib/scheduling/time';
import type { Prisma } from '@prisma/client';

const PAGE_SIZE = 30;

function statusLabel(status: string) {
  const words = status.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default async function DraftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await requireWorkspace(slug, 'post:view');
  const requestedPage = Number.parseInt(query.page ?? '1', 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  // Everything written but not yet given a publishing time. Scheduled and
  // published posts live on the calendar, so they are deliberately excluded.
  const where = {
    workspaceId: ctx.workspace.id,
    scheduledAt: null,
    status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] },
  } satisfies Prisma.PostWhereInput;
  const [drafts, total] = await Promise.all([
    db.post.findMany({
      where,
      include: {
        campaign: { select: { name: true } },
        platforms: { select: { platform: true, text: true } },
        queueItem: { select: { id: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.post.count({ where }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > pageCount) redirect(`/w/${slug}/drafts?page=${pageCount}`);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="b88-eyebrow">Posts · {ctx.workspace.timezone}</p>
          <h1 className="b88-page-title mt-3">Drafts</h1>
        </div>
        <Button href={`/w/${slug}/compose`}>Create post</Button>
      </div>
      <p className="mt-4 max-w-2xl">
        Posts saved without a publishing time. Give one a time to move it onto the calendar, or add it to the
        queue to publish it in the next open slot.
      </p>

      {drafts.length ? (
        <section className="b88-card mt-8">
          {drafts.map((post) => {
            const platforms = [...new Set(post.platforms.map((item) => PLATFORM_LABELS[item.platform]))];
            // || not ??: an untitled draft has an empty string, not null, and would
            // otherwise render a blank row.
            const preview = post.title?.trim() || post.platforms[0]?.text.trim().slice(0, 70) || 'Untitled post';
            return (
              <article
                key={post.id}
                className="flex items-center gap-4 border-t border-hairline-soft py-4 first:border-0"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-[var(--block-cream)]">
                  <StatusGlyph status={post.status} size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/w/${slug}/compose/${post.id}`}
                    className="flex min-h-11 items-center truncate font-[480] transition-opacity hover:opacity-80"
                  >
                    {preview}
                  </Link>
                  <p className="b88-caption mt-1">
                    {platforms.length ? platforms.join(', ') : 'No channel'}
                    {' · '}
                    {post.campaign ? `${post.campaign.name} · ` : ''}
                    Edited {formatInZone(post.updatedAt, ctx.workspace.timezone)}
                  </p>
                </div>
                <Link
                  href={`/w/${slug}/posts/${post.id}`}
                  className="flex min-h-10 shrink-0 items-center rounded-pill px-2 text-sm font-[480] transition-opacity hover:opacity-80 sm:px-3"
                  aria-label={`View details for ${preview}`}
                >
                  <span className="sm:hidden">Details</span>
                  <span className="hidden sm:inline">View details</span>
                </Link>
                {post.queueItem && <Badge tone="lilac">Queued</Badge>}
                <Badge tone={post.status === 'PENDING_APPROVAL' ? 'cream' : post.status === 'APPROVED' ? 'mint' : 'outline'}>
                  {statusLabel(post.status)}
                </Badge>
              </article>
            );
          })}
          {pageCount > 1 && (
            <nav className="mt-4 flex items-center justify-between gap-3 border-t border-hairline-soft pt-4" aria-label="Draft pages">
              <Button href={`/w/${slug}/drafts?page=${page - 1}`} variant="secondary" className={page <= 1 ? 'pointer-events-none opacity-40' : ''}>
                Previous
              </Button>
              <p className="b88-caption">Page {Math.min(page, pageCount)} of {pageCount}</p>
              <Button href={`/w/${slug}/drafts?page=${page + 1}`} variant="secondary" className={page >= pageCount ? 'pointer-events-none opacity-40' : ''}>
                Next
              </Button>
            </nav>
          )}
        </section>
      ) : (
        <div className="mt-8">
          <EmptyState
            eyebrow="No drafts"
            title="Nothing waiting to be scheduled"
            action={<Button href={`/w/${slug}/compose`}>Create post</Button>}
          >
            Posts you save without a publishing time collect here.
          </EmptyState>
        </div>
      )}
    </>
  );
}
