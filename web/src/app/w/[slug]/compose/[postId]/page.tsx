import { Badge } from '@/bridge88/components';
import { ComposerForm } from '@/components/composer-form';
import { ConfirmationButton, PendingButton } from '@/components/action-ui';
import { requireWorkspace } from '@/lib/auth/guard';
import { loadComposerContext } from '@/lib/posts/load';
import { postCommandAction, updatePostAction, type ComposerState } from '@/app/actions/posts';

const statusTone = {
  DRAFT: 'outline',
  PENDING_APPROVAL: 'cream',
  APPROVED: 'mint',
  SCHEDULED: 'lime',
  PUBLISHING: 'lilac',
  PUBLISHED: 'mint',
  FAILED: 'coral',
  CANCELLED: 'outline',
} as const;

export default async function EditComposePage({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug, postId } = await params;
  const ctx = await requireWorkspace(slug, 'post:view');
  const data = await loadComposerContext(ctx.workspace.id, slug, postId);
  if (!data.post) return null;

  async function action(state: ComposerState, formData: FormData): Promise<ComposerState> {
    'use server';
    return updatePostAction(slug, postId, state, formData);
  }
  const scheduledLabel = data.initial?.scheduledAt
    ? data.initial.scheduledAt.replace('T', ' ')
    : 'Not scheduled';

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="b88-eyebrow">Composer</p>
          <h1 className="b88-page-title mt-3">Edit post</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[data.post.status]}>{data.post.status.toLowerCase().replace('_', ' ')}</Badge>
            <span className="b88-caption">{scheduledLabel}</span>
          </div>
        </div>
        <PostCommands
          slug={slug}
          postId={postId}
          status={data.post.status}
          timezone={data.timezone}
          canDelete={ctx.can('post:delete')}
          canPublish={ctx.can('post:publish')}
          canSchedule={ctx.can('post:schedule')}
        />
      </div>
      {data.accounts.length ? (
        <ComposerForm
          slug={slug}
          action={action}
          accounts={data.accounts}
          assets={data.assets}
          campaigns={data.campaigns}
          timezone={data.timezone}
          postId={postId}
          postStatus={data.post.status}
          initial={data.initial}
          canSchedule={ctx.can('post:schedule')}
          canPublish={ctx.can('post:publish')}
          canSubmitForApproval={ctx.can('post:submit_for_approval')}
        />
      ) : (
        <section className="rounded-lg bg-[var(--block-cream)] p-8">
          <p className="b88-eyebrow">No channels</p>
          <h2 className="b88-heading mt-3">Reconnect an account to keep editing this post.</h2>
        </section>
      )}
    </>
  );
}

function PostCommands({
  slug,
  postId,
  status,
  timezone,
  canDelete,
  canPublish,
  canSchedule,
}: {
  slug: string;
  postId: string;
  status: string;
  timezone: string;
  canDelete: boolean;
  canPublish: boolean;
  canSchedule: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={async () => { 'use server'; await postCommandAction(slug, postId, 'duplicate'); }}>
        <PendingButton type="submit" variant="secondary" pendingLabel="Duplicating">Duplicate</PendingButton>
      </form>
      {['DRAFT', 'SCHEDULED', 'FAILED', 'APPROVED'].includes(status) && canPublish && (
        <form action={async () => { 'use server'; await postCommandAction(slug, postId, status === 'FAILED' ? 'retry' : 'publish'); }}>
          <PendingButton type="submit" variant="secondary" pendingLabel="Publishing">{status === 'FAILED' ? 'Retry publish' : 'Publish now'}</PendingButton>
        </form>
      )}
      {status === 'SCHEDULED' && (
        <form action={async () => { 'use server'; await postCommandAction(slug, postId, 'cancel'); }}>
          <PendingButton type="submit" variant="tertiary" pendingLabel="Cancelling">Cancel schedule</PendingButton>
        </form>
      )}
      {['SCHEDULED', 'FAILED', 'CANCELLED'].includes(status) && canSchedule && (
        <form action={async (formData: FormData) => { 'use server'; await postCommandAction(slug, postId, 'reschedule', formData); }} className="flex items-center gap-2">
          <input type="datetime-local" name="scheduledAt" className="b88-filter-control w-auto" aria-label={`Reschedule (${timezone})`} />
          <PendingButton type="submit" variant="secondary" pendingLabel="Rescheduling">Reschedule</PendingButton>
        </form>
      )}
      {canDelete && (
        <form action={async () => { 'use server'; await postCommandAction(slug, postId, 'delete'); }}>
          <ConfirmationButton type="submit" variant="tertiary" confirmMessage="Delete this post permanently?" pendingLabel="Deleting">
            Delete
          </ConfirmationButton>
        </form>
      )}
    </div>
  );
}
