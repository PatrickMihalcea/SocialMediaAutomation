'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2, X } from 'lucide-react';
import { Badge, Button, Checkbox, MediaFrame, StatusMessage } from '@/bridge88/components';
import { StatusGlyph } from '@/components/visuals';
import { deletePostsAction } from '@/app/actions/posts';
import { POST_STATUS_LABELS } from '@/lib/posts/labels';

export interface DraftRow {
  id: string;
  preview: string;
  status: string;
  channels: string;
  meta: string;
  queued: boolean;
  deletable: boolean;
  media: { id: string; url: string; type: string; width: number | null; height: number | null }[];
  mediaCount: number;
}

/**
 * The drafts list, with the two things a list of near-identical posts needs.
 *
 * A thumbnail, because a workflow that generated twelve treehouse posts gives
 * twelve rows whose titles differ by a word; the picture is what tells them
 * apart. And multi-select, because clearing those twelve out meant twelve
 * confirmations for a single decision.
 */
export function DraftsList({ slug, drafts, canDelete }: {
  slug: string;
  drafts: DraftRow[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selectable = drafts.filter((draft) => draft.deletable);
  const allSelected = selectable.length > 0 && selected.length === selectable.length;

  function toggle(id: string, checked: boolean) {
    setSelected((current) => (checked ? [...current, id] : current.filter((entry) => entry !== id)));
  }

  function deleteSelected() {
    const count = selected.length;
    if (!window.confirm(`Delete ${count} ${count === 1 ? 'draft' : 'drafts'} permanently?`)) return;
    startTransition(async () => {
      try {
        const result = await deletePostsAction(slug, selected);
        setSelected([]);
        setNotice({ tone: 'success', message: result.message });
        router.refresh();
      } catch (error) {
        setNotice({
          tone: 'error',
          message: error instanceof Error ? error.message : 'The drafts could not be deleted.',
        });
      }
    });
  }

  return (
    <>
      {notice && <StatusMessage className="mt-6" tone={notice.tone}>{notice.message}</StatusMessage>}

      <section className="b88-card mt-8">
        {canDelete && selectable.length > 1 && (
          <div className="flex items-center gap-3 border-b border-hairline-soft pb-3">
            <Checkbox
              label={allSelected ? 'Clear selection' : `Select all ${selectable.length}`}
              checked={allSelected}
              onChange={(event) =>
                setSelected(event.target.checked ? selectable.map((draft) => draft.id) : [])
              }
            />
          </div>
        )}

        {drafts.map((draft) => (
          <article
            key={draft.id}
            className="flex items-center gap-4 border-t border-hairline-soft py-4 first:border-0"
          >
            {canDelete && (
              <Checkbox
                label={`Select ${draft.preview}`}
                hideLabel
                checked={selected.includes(draft.id)}
                disabled={!draft.deletable}
                onChange={(event) => toggle(draft.id, event.target.checked)}
              />
            )}

            {/* The picture, or the status glyph when there is nothing to show.
                A row with no media is not a broken row. */}
            {draft.media.length ? (
              <span className="flex shrink-0 gap-1">
                {draft.media.map((item) => (
                  <span key={item.id} className="w-11">
                    <MediaFrame
                      ratio={item.width && item.height ? `${item.width} / ${item.height}` : '1:1'}
                      tone="mint"
                      type="image"
                      src={item.url}
                      alt=""
                    />
                  </span>
                ))}
                {draft.mediaCount > draft.media.length && (
                  <span className="b88-caption flex w-11 items-center justify-center rounded-md bg-surface-soft">
                    +{draft.mediaCount - draft.media.length}
                  </span>
                )}
              </span>
            ) : (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-[var(--block-cream)]">
                <StatusGlyph status={draft.status} size={19} />
              </span>
            )}

            <div className="min-w-0 flex-1">
              <Link
                href={`/w/${slug}/compose/${draft.id}`}
                className="flex min-h-11 items-center truncate font-[480] transition-opacity hover:opacity-80"
              >
                {draft.preview}
              </Link>
              <p className="b88-caption mt-1">{draft.channels} · {draft.meta}</p>
            </div>

            <Link
              href={`/w/${slug}/posts/${draft.id}`}
              className="flex min-h-10 shrink-0 items-center rounded-pill px-2 text-sm font-[480] transition-opacity hover:opacity-80 sm:px-3"
              aria-label={`View details for ${draft.preview}`}
            >
              <span className="sm:hidden">Details</span>
              <span className="hidden sm:inline">View details</span>
            </Link>
            {draft.queued && <Badge tone="lilac">Queued</Badge>}
            <Badge tone={draft.status === 'PENDING_APPROVAL' ? 'cream' : draft.status === 'APPROVED' ? 'mint' : 'outline'}>
              {POST_STATUS_LABELS[draft.status as keyof typeof POST_STATUS_LABELS] ?? draft.status}
            </Badge>
          </article>
        ))}
      </section>

      {/* Fixed, so the count and the action stay reachable however far down the
          list the selection was made. */}
      {canDelete && selected.length > 0 && (
        <div className="sticky bottom-4 z-30 mt-4 flex flex-wrap items-center justify-center gap-3 rounded-pill bg-canvas-inverse px-4 py-3 text-on-primary shadow-lg">
          <span className="b88-caption">{selected.length} selected</span>
          <Button type="button" variant="secondary" disabled={pending} onClick={deleteSelected}>
            <Trash2 size={16} /> {pending ? 'Deleting…' : 'Delete'}
          </Button>
          <Button type="button" variant="tertiary" onClick={() => setSelected([])} aria-label="Clear selection">
            <X size={16} />
          </Button>
        </div>
      )}
    </>
  );
}
