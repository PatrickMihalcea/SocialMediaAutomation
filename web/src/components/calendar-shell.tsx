'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import {
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Copy,
  GripVertical,
  List,
  Lock,
  PenLine,
  Send,
  Trash2,
} from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, Field, IconButton, StatusMessage } from '@/bridge88/components';
import { postCommandAction } from '@/app/actions/posts';
import {
  commitBulkScheduleAction,
  previewBulkScheduleAction,
  reschedulePostAction,
} from '@/app/actions/queue';
import { PlatformGlyph, StatusGlyph } from '@/components/visuals';

export type CalendarPost = {
  id: string;
  title: string;
  text: string;
  status: string;
  scheduledAt: string | null;
  campaign: string | null;
  platforms: string[];
  accounts: string[];
};

type Option = { value: string; label: string };
const tones: Record<string, 'outline' | 'cream' | 'mint' | 'lime' | 'lilac' | 'coral'> = {
  DRAFT: 'outline', PENDING_APPROVAL: 'cream', APPROVED: 'mint', SCHEDULED: 'lime',
  PUBLISHING: 'lilac', PUBLISHED: 'mint', FAILED: 'coral', CANCELLED: 'outline',
};
const statusBlocks: Record<string, string> = {
  DRAFT: 'bg-surface-soft',
  PENDING_APPROVAL: 'bg-[var(--block-cream)]',
  APPROVED: 'bg-[var(--block-mint)]',
  SCHEDULED: 'bg-[var(--block-lime)]',
  PUBLISHING: 'bg-[var(--block-lilac)]',
  PUBLISHED: 'bg-[var(--block-mint)]',
  FAILED: 'bg-[var(--block-coral)]',
  CANCELLED: 'bg-surface-soft',
};

function actionError(result: unknown): string | null {
  if (result && typeof result === 'object' && 'status' in result) {
    const value = result as { status?: unknown; error?: unknown };
    if (value.status === 'error') return typeof value.error === 'string' ? value.error : 'The action could not be completed.';
  }
  return null;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'The action could not be completed.';
}

function statusLabel(status: string) {
  const words = status.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A post that has gone out, or is going out right now, has no date left to plan. */
function isMovable(status: string) {
  return status !== 'PUBLISHED' && status !== 'PUBLISHING';
}

function publishedMoveHint(status: string) {
  return status === 'PUBLISHING'
    ? 'This post is publishing right now. Wait for it to finish before changing its date.'
    : 'This post has already been published, so its date can no longer change. Duplicate it to post the same content again.';
}

export function CalendarShell({
  slug,
  timezone,
  posts,
  view,
  anchor,
  selectedPost,
  filters,
  platformOptions,
  accountOptions,
  campaignOptions,
  canDelete,
}: {
  slug: string;
  timezone: string;
  posts: CalendarPost[];
  view: 'month' | 'week' | 'list';
  anchor: string;
  selectedPost?: CalendarPost;
  filters: Record<string, string>;
  platformOptions: Option[];
  accountOptions: Option[];
  campaignOptions: Option[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStart, setBulkStart] = useState('');
  const [bulkSlots, setBulkSlots] = useState<string[]>([]);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null);
  // Resolved after hydration so the server render never disagrees about the date.
  const [todayKey, setTodayKey] = useState<string | null>(null);
  useEffect(() => setTodayKey(DateTime.now().setZone(timezone).toISODate()), [timezone]);

  useEffect(() => {
    if (
      !publishingPostId &&
      selectedPost?.status === 'SCHEDULED' &&
      selectedPost.scheduledAt &&
      DateTime.fromISO(selectedPost.scheduledAt).toMillis() <= Date.now() + 60_000
    ) {
      setPublishingPostId(selectedPost.id);
      setMessage({ text: 'Publishing post.', tone: 'success' });
    }
  }, [publishingPostId, selectedPost]);

  useEffect(() => {
    if (!publishingPostId || selectedPost?.id !== publishingPostId) return;
    if (selectedPost.status === 'PUBLISHED') {
      setPublishingPostId(null);
      setMessage({ text: 'Published via a simulated integration.', tone: 'success' });
      return;
    }
    if (selectedPost.status === 'FAILED') {
      setPublishingPostId(null);
      setMessage({ text: 'Publishing failed. Review the post and try again.', tone: 'error' });
      return;
    }
    const refreshTimer = window.setTimeout(() => router.refresh(), 800);
    return () => window.clearTimeout(refreshTimer);
  }, [publishingPostId, router, selectedPost]);

  const anchorDate = DateTime.fromISO(anchor, { zone: timezone }).startOf('day');
  const visibleDays = useMemo(() => {
    const visibleAnchor = DateTime.fromISO(anchor, { zone: timezone }).startOf('day');
    if (view === 'week') {
      const start = visibleAnchor.startOf('week');
      return Array.from({ length: 7 }, (_, index) => start.plus({ days: index }));
    }
    if (view === 'month') {
      const start = visibleAnchor.startOf('month').startOf('week');
      return Array.from({ length: 42 }, (_, index) => start.plus({ days: index }));
    }
    return [];
  }, [anchor, timezone, view]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const post of posts) {
      if (!post.scheduledAt) continue;
      const key = DateTime.fromISO(post.scheduledAt).setZone(timezone).toISODate()!;
      map.set(key, [...(map.get(key) ?? []), post]);
    }
    return map;
  }, [posts, timezone]);

  function navigate(next: Record<string, string | undefined>) {
    const params = new URLSearchParams({ ...filters, view, date: anchor });
    Object.entries(next).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
    router.push(`/w/${slug}/calendar?${params}`);
  }

  function movePost(postId: string, day: DateTime) {
    const post = posts.find((item) => item.id === postId);
    if (post && !isMovable(post.status)) {
      setMessage({ text: publishedMoveHint(post.status), tone: 'error' });
      return;
    }
    const old = post?.scheduledAt ? DateTime.fromISO(post.scheduledAt).setZone(timezone) : null;
    const target = day.set({ hour: old?.hour ?? 9, minute: old?.minute ?? 0 });
    // Moving a post earlier is fine; landing it in the past is not. Say which
    // one went wrong so an earlier drop does not look like a banned direction.
    if (target.toMillis() <= DateTime.now().setZone(timezone).toMillis()) {
      setMessage({
        text: `${target.toFormat('d LLL, HH:mm')} has already passed. Moving a post earlier is fine — moving it into the past is not.`,
        tone: 'error',
      });
      return;
    }
    const local = target.toFormat("yyyy-MM-dd'T'HH:mm");
    startTransition(async () => {
      try {
        const result = await reschedulePostAction(slug, postId, local);
        const error = actionError(result);
        if (error) {
          setMessage({ text: error, tone: 'error' });
          return;
        }
        setMessage({ text: `Post moved to ${day.toFormat('d LLL')}.`, tone: 'success' });
        router.refresh();
      } catch (error) {
        setMessage({ text: errorMessage(error), tone: 'error' });
      }
    });
  }

  function command(postId: string, action: 'duplicate' | 'delete' | 'publish' | 'retry' | 'cancel') {
    if (action === 'publish' || action === 'retry') {
      setPublishingPostId(postId);
      setMessage({ text: action === 'retry' ? 'Retrying publish.' : 'Publishing post.', tone: 'success' });
    }
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set('clientManaged', '1');
        const result = await postCommandAction(slug, postId, action, formData);
        const error = actionError(result);
        if (error) {
          setPublishingPostId(null);
          setMessage({ text: error, tone: 'error' });
          return;
        }
        setDeleteOpen(false);
        if (action === 'delete') {
          setMessage({ text: result.success ?? 'Post deleted.', tone: 'success' });
          navigate({ post: undefined });
          return;
        }
        if (result.redirectTo) {
          router.push(result.redirectTo);
          return;
        }
        if (action !== 'publish' && action !== 'retry') {
          setMessage({ text: result.success ?? 'Post updated.', tone: 'success' });
        }
        router.refresh();
      } catch (error) {
        setPublishingPostId(null);
        setMessage({ text: errorMessage(error), tone: 'error' });
      }
    });
  }

  const directionUnit = view === 'month' ? { months: 1 } : { weeks: 1 };
  return (
    <>
      {message && <StatusMessage tone={message.tone} className="mt-6">{message.text}</StatusMessage>}
      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {([
            ['month', 'Month', CalendarDays],
            ['week', 'Week', CalendarRange],
            ['list', 'List', List],
          ] as const).map(([item, label, Icon]) => (
            <Button type="button" key={item} variant={view === item ? 'primary' : 'secondary'} onClick={() => navigate({ view: item })}>
              <Icon size={16} strokeWidth={1.75} /> {label}
            </Button>
          ))}
        </div>
        {view !== 'list' && (
          <div className="flex flex-wrap items-center gap-2">
            <IconButton type="button" icon={ChevronLeft} label="Previous" onClick={() => navigate({ date: anchorDate.minus(directionUnit).toISODate()! })} />
            <IconButton type="button" icon={CalendarCheck} label="Today" onClick={() => navigate({ date: DateTime.now().setZone(timezone).toISODate()! })} />
            <IconButton type="button" icon={ChevronRight} label="Next" onClick={() => navigate({ date: anchorDate.plus(directionUnit).toISODate()! })} />
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Filter label="Platform" value={filters.platform} options={platformOptions} onChange={(value) => navigate({ platform: value })} />
        <Filter label="Status" value={filters.status} options={[
          { value: 'DRAFT', label: 'Draft' }, { value: 'PENDING_APPROVAL', label: 'In review' },
          { value: 'SCHEDULED', label: 'Scheduled' }, { value: 'PUBLISHED', label: 'Published' },
          { value: 'FAILED', label: 'Failed' },
        ]} onChange={(value) => navigate({ status: value })} />
        <Filter label="Campaign" value={filters.campaign} options={campaignOptions} onChange={(value) => navigate({ campaign: value })} />
        <Filter label="Account" value={filters.account} options={accountOptions} onChange={(value) => navigate({ account: value })} />
      </div>

      {view === 'list' ? (
        <PostList posts={posts} selected={selected} setSelected={setSelected} slug={slug} timezone={timezone} />
      ) : (
        <div className="mt-6 overflow-x-auto">
          <div className="min-w-[720px] overflow-hidden rounded-lg border border-hairline">
            <div className="grid grid-cols-7 border-b border-hairline bg-surface-soft">
              {visibleDays.slice(0, 7).map((day) => (
                <p key={day.weekday} className="b88-caption px-2 py-3">{day.toFormat('cccc')}</p>
              ))}
            </div>
            <section className="grid grid-cols-7">
              {visibleDays.map((day) => {
                const key = day.toISODate()!;
                const dayPosts = byDay.get(key) ?? [];
                const isToday = key === todayKey;
                return (
                  <div
                    key={key}
                    aria-current={isToday ? 'date' : undefined}
                    className={`min-h-36 border-b border-r border-hairline-soft p-2 ${day.month !== anchorDate.month && view === 'month' ? 'bg-surface-soft' : ''}`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => movePost(event.dataTransfer.getData('text/post-id'), day)}
                  >
                    <p className="b88-caption">
                      {isToday ? (
                        <span className="inline-flex items-center rounded-sm bg-[var(--block-cream)] px-2 py-0.5">
                          {day.toFormat('d')} · Today
                        </span>
                      ) : day.day === 1 ? day.toFormat('d LLL') : day.toFormat('d')}
                    </p>
                    <div className="mt-2 space-y-1">
                      {dayPosts.map((post) => (
                        <button
                          type="button"
                          key={post.id}
                          draggable={isMovable(post.status)}
                          title={isMovable(post.status) ? undefined : publishedMoveHint(post.status)}
                          onDragStart={(event) => event.dataTransfer.setData('text/post-id', post.id)}
                          onClick={() => navigate({ post: post.id })}
                          className={`block w-full rounded-sm p-2 text-left text-xs transition-opacity hover:opacity-80 ${isMovable(post.status) ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${statusBlocks[post.status] ?? 'bg-surface-soft'}`}
                        >
                          <span className="mb-1 flex items-center gap-1.5">
                            {isMovable(post.status)
                              ? <GripVertical size={13} strokeWidth={1.75} aria-hidden />
                              : <Lock size={13} strokeWidth={1.75} aria-hidden />}
                            <StatusGlyph status={post.status} size={13} />
                            {post.platforms.slice(0, 2).map((platform) => <PlatformGlyph key={platform} platform={platform} size={13} />)}
                          </span>
                          <span className="block truncate font-[480]">{post.title}</span>
                          <span className="b88-caption">{DateTime.fromISO(post.scheduledAt!).setZone(timezone).toFormat('HH:mm')}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
        </div>
      )}

      {view === 'list' && selected.length > 0 && (
        <section className="b88-card mt-6">
          <p className="b88-eyebrow">Bulk schedule · {selected.length} posts</p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label={`Start time (${timezone})`} type="datetime-local" value={bulkStart} onChange={(event) => setBulkStart(event.target.value)} />
            <Button type="button" disabled={pending} onClick={() => startTransition(async () => {
              try {
                const slots = await previewBulkScheduleAction(slug, selected, bulkStart || undefined);
                setBulkSlots(slots);
                setMessage(null);
              } catch (error) {
                setMessage({ text: errorMessage(error), tone: 'error' });
              }
            })}>Preview schedule</Button>
          </div>
          {bulkSlots.length > 0 && (
            <div className="mt-6">
              <ol className="space-y-2">
                {bulkSlots.map((slot, index) => <li key={slot} className="b88-caption">{posts.find((p) => p.id === selected[index])?.title} · {DateTime.fromISO(slot).setZone(timezone).toFormat('ccc d LLL, HH:mm')}</li>)}
              </ol>
              {bulkSlots.length !== selected.length && <StatusMessage tone="error" className="mt-3">There are not enough free queue slots.</StatusMessage>}
              <Button type="button" className="mt-4" disabled={pending || bulkSlots.length !== selected.length} onClick={() => startTransition(async () => {
                try {
                  const result = await commitBulkScheduleAction(slug, selected, bulkSlots);
                  const error = actionError(result);
                  if (error) {
                    setMessage({ text: error, tone: 'error' });
                    return;
                  }
                  setSelected([]);
                  setBulkSlots([]);
                  setMessage({ text: 'Posts scheduled.', tone: 'success' });
                  router.refresh();
                } catch (error) {
                  setMessage({ text: errorMessage(error), tone: 'error' });
                }
              })}>Confirm schedule</Button>
            </div>
          )}
        </section>
      )}

      {selectedPost && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => navigate({ post: undefined })}>
          <aside className="h-full w-full max-w-lg overflow-y-auto bg-canvas p-6" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="b88-eyebrow">Post detail</p><h2 className="b88-heading mt-2">{selectedPost.title}</h2></div>
              <Button type="button" variant="tertiary" onClick={() => navigate({ post: undefined })}>Close</Button>
            </div>
            {message?.tone === 'error' && <StatusMessage tone="error" className="mt-6">{message.text}</StatusMessage>}
            <div className="mt-6 flex flex-wrap gap-2"><Badge tone={tones[selectedPost.status] ?? 'outline'}>{statusLabel(selectedPost.status)}</Badge>{selectedPost.platforms.map((p) => <Badge key={p} tone="outline">{p}</Badge>)}</div>
            {selectedPost.status === 'PUBLISHED' && (
              <StatusMessage tone="success" className="mt-6">
                Published via a simulated integration.
              </StatusMessage>
            )}
            <p className="mt-6 whitespace-pre-wrap">{selectedPost.text || 'No copy in this post.'}</p>
            <dl className="mt-6 space-y-3 text-sm">
              <div><dt className="b88-caption">Publishing time</dt><dd>{selectedPost.scheduledAt ? DateTime.fromISO(selectedPost.scheduledAt).setZone(timezone).toFormat('ccc d LLL yyyy, HH:mm ZZZZ') : 'Not scheduled'}</dd></div>
              <div><dt className="b88-caption">Accounts</dt><dd>{selectedPost.accounts.join(', ') || 'No account'}</dd></div>
              <div><dt className="b88-caption">Campaign</dt><dd>{selectedPost.campaign ?? 'No campaign'}</dd></div>
            </dl>
            <div className="mt-8 flex flex-wrap gap-2">
              <Button type="button" href={`/w/${slug}/compose/${selectedPost.id}`}><PenLine size={16} strokeWidth={1.75} /> Edit post</Button>
              {['DRAFT', 'APPROVED', 'SCHEDULED', 'FAILED', 'CANCELLED'].includes(selectedPost.status) && <Button type="button" disabled={pending || publishingPostId === selectedPost.id} aria-busy={publishingPostId === selectedPost.id} onClick={() => command(selectedPost.id, selectedPost.status === 'FAILED' ? 'retry' : 'publish')}><Send size={16} strokeWidth={1.75} /> {publishingPostId === selectedPost.id ? 'Publishing' : selectedPost.status === 'FAILED' ? 'Retry publish' : 'Publish now'}</Button>}
              <Button type="button" variant="secondary" disabled={pending} onClick={() => command(selectedPost.id, 'duplicate')}><Copy size={16} strokeWidth={1.75} /> Duplicate</Button>
              {selectedPost.status === 'SCHEDULED' && <Button type="button" variant="secondary" disabled={pending} onClick={() => command(selectedPost.id, 'cancel')}><CalendarX size={16} strokeWidth={1.75} /> Cancel</Button>}
              {canDelete && <Button type="button" variant="tertiary" disabled={pending} onClick={() => setDeleteOpen(true)}><Trash2 size={16} strokeWidth={1.75} /> Delete</Button>}
            </div>
          </aside>
        </div>
      )}
      <Dialog
        open={deleteOpen}
        eyebrow="Confirm"
        title="Delete this post?"
        onClose={() => setDeleteOpen(false)}
        actions={<>
          <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)}>Keep post</Button>
          <Button type="button" disabled={pending} onClick={() => selectedPost && command(selectedPost.id, 'delete')}><Trash2 size={16} strokeWidth={1.75} /> Delete post</Button>
        </>}
      >
        This permanently removes the post and its publishing history.
        {message?.tone === 'error' && <StatusMessage tone="error" className="mt-4">{message.text}</StatusMessage>}
      </Dialog>
    </>
  );
}

function Filter({ label, value, options, onChange }: { label: string; value?: string; options: Option[]; onChange: (value?: string) => void }) {
  return <label><span className="b88-label">{label}</span><select className="b88-input" value={value ?? ''} onChange={(event) => onChange(event.target.value || undefined)}><option value="">All</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function PostList({ posts, selected, setSelected, slug, timezone }: {
  posts: CalendarPost[]; selected: string[]; setSelected: (ids: string[]) => void; slug: string; timezone: string;
}) {
  if (!posts.length) return <div className="mt-6"><EmptyState eyebrow="No matching posts" title="The calendar is clear">Change the filters or create a post.</EmptyState></div>;
  return (
    <section className="b88-card mt-6 overflow-x-auto">
      <table className="b88-table min-w-[760px] [&_td:first-child]:pl-0 [&_th:first-child]:pl-0"><thead><tr><th>Select</th><th>Post</th><th>Channels</th><th>Publishing time</th><th>Status</th><th>Campaign</th></tr></thead>
        <tbody>{posts.map((post) => <tr key={post.id}>
          <td><input aria-label={`Select ${post.title}`} type="checkbox" checked={selected.includes(post.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, post.id] : selected.filter((id) => id !== post.id))} /></td>
          <td><Button type="button" variant="tertiary" href={`/w/${slug}/compose/${post.id}`}><PenLine size={15} strokeWidth={1.75} /> {post.title}</Button></td>
          <td>{post.platforms.join(', ') || '—'}</td>
          <td>{post.scheduledAt ? DateTime.fromISO(post.scheduledAt).setZone(timezone).toFormat('ccc d LLL, HH:mm') : 'Not scheduled'}</td>
          <td><Badge tone={tones[post.status] ?? 'outline'}>{statusLabel(post.status)}</Badge></td><td>{post.campaign ?? '—'}</td>
        </tr>)}</tbody>
      </table>
    </section>
  );
}
