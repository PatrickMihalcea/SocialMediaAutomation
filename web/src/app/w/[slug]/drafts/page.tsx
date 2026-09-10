import Link from 'next/link';
import { Badge, Button, EmptyState } from '@/bridge88/components';
import { StatusGlyph } from '@/components/visuals';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { formatInZone } from '@/lib/scheduling/time';

function statusLabel(status: string) {
  const words = status.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default async function DraftsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'post:view');

  // Everything written but not yet given a publishing time. Scheduled and
  // published posts live on the calendar, so they are deliberately excluded.
  const drafts = await db.post.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      scheduledAt: null,
      status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] },
    },
    include: {
      campaign: { select: { name: true } },
      platforms: { select: { platform: true, text: true } },
      queueItem: { select: { id: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });

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
              <Link
                key={post.id}
                href={`/w/${slug}/compose/${post.id}`}
                className="flex items-center gap-4 border-t border-hairline-soft py-4 transition-opacity first:border-0 hover:opacity-80"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-[var(--block-cream)]">
                  <StatusGlyph status={post.status} size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-[480]">{preview}</p>
                  <p className="b88-caption mt-1">
                    {platforms.length ? platforms.join(', ') : 'No channel'}
                    {' · '}
                    {post.campaign ? `${post.campaign.name} · ` : ''}
                    Edited {formatInZone(post.updatedAt, ctx.workspace.timezone)}
                  </p>
                </div>
                {post.queueItem && <Badge tone="lilac">Queued</Badge>}
                <Badge tone={post.status === 'PENDING_APPROVAL' ? 'cream' : post.status === 'APPROVED' ? 'mint' : 'outline'}>
                  {statusLabel(post.status)}
                </Badge>
              </Link>
            );
          })}
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
