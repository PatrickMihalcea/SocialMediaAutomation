
import { redirect } from 'next/navigation';
import { Button, EmptyState } from '@/bridge88/components';
import { DraftsList, type DraftRow } from '@/components/drafts-list';
import { storage } from '@/lib/storage';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { formatInZone } from '@/lib/scheduling/time';
import type { Prisma } from '@prisma/client';
import { isPostActionLegal } from '@/lib/posts/lifecycle';

const PAGE_SIZE = 30;

export const metadata = { title: 'Drafts' };

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
    status: { in: ['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'APPROVED'] },
  } satisfies Prisma.PostWhereInput;
  const [drafts, total] = await Promise.all([
    db.post.findMany({
      where,
      include: {
        campaign: { select: { name: true } },
        platforms: {
          select: {
            platform: true,
            text: true,
            // Enough to tell one generated draft from eleven others like it.
            media: {
              orderBy: { position: 'asc' },
              select: {
                mediaAsset: {
                  select: {
                    id: true,
                    type: true,
                    width: true,
                    height: true,
                    thumbnailKey: true,
                    storageKey: true,
                  },
                },
              },
            },
          },
        },
        queueItem: { select: { id: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.post.count({ where }),
  ]);
  const canDelete = ctx.can('post:delete');
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Signed here, in one pass, because they expire and a client cannot mint them.
  const rows: DraftRow[] = await Promise.all(drafts.map(async (post) => {
    const platforms = [...new Set(post.platforms.map((item) => PLATFORM_LABELS[item.platform]))];
    // || not ??: an untitled draft has an empty string, not null, and would
    // otherwise render a blank row.
    const preview = post.title?.trim() || post.platforms[0]?.text.trim().slice(0, 70) || 'Untitled post';
    const assets = [...new Map(
      post.platforms.flatMap((platform) => platform.media.map(({ mediaAsset }) => [mediaAsset.id, mediaAsset])),
    ).values()];
    return {
      id: post.id,
      preview,
      status: post.status,
      channels: platforms.length ? platforms.join(', ') : 'No channel',
      meta: `${post.campaign ? `${post.campaign.name} · ` : ''}Edited ${formatInZone(post.updatedAt, ctx.workspace.timezone)}`,
      queued: Boolean(post.queueItem),
      deletable: isPostActionLegal(post.status, 'delete'),
      mediaCount: assets.length,
      media: await Promise.all(assets.slice(0, 3).map(async (asset) => ({
        id: asset.id,
        type: asset.type,
        width: asset.width,
        height: asset.height,
        url: await storage().signedUrl(asset.thumbnailKey ?? asset.storageKey),
      }))),
    };
  }));
  if (page > pageCount) redirect(`/w/${slug}/drafts?page=${pageCount}`);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="b88-eyebrow">Posts</p>
          <h1 className="b88-page-title mt-3">Drafts</h1>
        </div>
        <Button href={`/w/${slug}/compose`}>Create post</Button>
      </div>

      {drafts.length ? (
        <>
          <DraftsList slug={slug} drafts={rows} canDelete={canDelete} />
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
        </>
      ) : (
        <div className="mt-8">
          <EmptyState
            eyebrow="No drafts"
            title="Nothing waiting to be scheduled"
            action={<Button href={`/w/${slug}/compose`}>Create post</Button>}
          />
        </div>
      )}
    </>
  );
}
