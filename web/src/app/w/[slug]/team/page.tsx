import { Avatar, Badge, Button, Select } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import {
  approvalAction, removeMemberAction, resendInviteAction,
  revokeInviteAction, updateMemberRoleAction,
} from '@/app/actions/team';
import { ActionForm } from '@/components/action-form';
import { ConfirmationButton, PendingButton } from '@/components/action-ui';
import type { ActionState } from '@/lib/actions/state';
import { InviteForm } from './invite-form';

function sentenceCase(value: string) {
  const words = value.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function resendInviteFormAction(slug: string, inviteId: string, _state: ActionState, _formData: FormData) {
  'use server';
  return resendInviteAction(slug, inviteId);
}

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'member:view');
  const [members, invites, reviews] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId: ctx.workspace.id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.workspaceInvite.findMany({
      where: { workspaceId: ctx.workspace.id, acceptedAt: null, expiresAt: { gt: new Date() } },
    }),
    db.post.findMany({
      where: { workspaceId: ctx.workspace.id, status: 'PENDING_APPROVAL' },
      include: { author: true, platforms: { take: 1 } },
      orderBy: { updatedAt: 'asc' },
    }),
  ]);
  return (
    <>
      <p className="b88-eyebrow">Collaboration</p><h1 className="b88-page-title mt-3">Team and approvals</h1>
      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,.8fr)]">
        <section className="b88-card">
          <p className="b88-caption">Members</p><h2 className="b88-heading mt-2">Workspace access</h2>
          <div className="mt-5">
            {members.map((member) => (
              <div key={member.id} className="flex flex-wrap items-center gap-3 border-t border-hairline-soft py-4 first:border-0">
                <Avatar name={member.user.name ?? member.user.email} src={member.user.image}/>
                <div className="min-w-0 flex-1"><p className="truncate font-[480]">{member.user.name ?? member.user.email}</p><p className="text-sm">{member.user.email}</p></div>
                {member.role === 'OWNER' || !ctx.can('member:update_role') ? (
                  <Badge tone={member.role === 'OWNER' ? 'ink' : 'outline'}>{sentenceCase(member.role)}</Badge>
                ) : (
                  <form action={updateMemberRoleAction.bind(null, slug, member.id)} className="flex flex-wrap items-center gap-2">
                    <Select name="role" label={`Role for ${member.user.name ?? member.user.email}`} className="min-h-10 w-auto min-w-28 py-2" defaultValue={member.role}>
                      <option value="EDITOR">Editor</option><option value="VIEWER">Viewer</option><option value="ADMIN">Admin</option>
                    </Select>
                    <Button type="submit" variant="secondary">Save</Button>
                  </form>
                )}
                {member.role !== 'OWNER' && ctx.can('member:remove') && (
                  <form action={removeMemberAction.bind(null, slug, member.id)}>
                    <ConfirmationButton confirmMessage={`Remove ${member.user.name ?? member.user.email} from this workspace?`} variant="tertiary" pendingLabel="Removing">Remove</ConfirmationButton>
                  </form>
                )}
              </div>
            ))}
          </div>
          {!!invites.length && <div className="mt-5 rounded-md bg-surface-soft p-4"><p className="b88-caption">Pending invites</p>{invites.map((invite) => (
            <div key={invite.id} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="mr-auto">{invite.email} · {sentenceCase(invite.role)}</span>
              {ctx.can('member:invite') && <><ActionForm action={resendInviteFormAction.bind(null, slug, invite.id)}><PendingButton type="submit" variant="secondary" pendingLabel="Resending">Resend</PendingButton></ActionForm><form action={revokeInviteAction.bind(null, slug, invite.id)}><ConfirmationButton confirmMessage={`Revoke the invitation for ${invite.email}?`} variant="tertiary" pendingLabel="Revoking">Revoke</ConfirmationButton></form></>}
            </div>
          ))}</div>}
        </section>
        {ctx.can('member:invite') && (
          <InviteForm slug={slug} />
        )}
      </div>

      <section className="b88-card mt-6">
        <p className="b88-caption">Approval queue</p><h2 className="b88-heading mt-2">Waiting for review</h2>
        {reviews.length ? <div className="mt-5 space-y-4">{reviews.map((post) => (
          <article key={post.id} className="rounded-md bg-surface-soft p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-[540]">{post.title ?? 'Untitled post'}</p><p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm">{post.platforms[0]?.text}</p></div><Badge tone="cream">In review</Badge></div>
            {ctx.can('post:approve') && <form className="mt-4">
              <input name="body" className="b88-input max-w-md" placeholder="Optional review note" aria-label="Review note"/>
              <div className="mt-3 flex flex-wrap gap-2"><Button formAction={approvalAction.bind(null, slug, post.id, 'APPROVED')} type="submit">Approve</Button><Button formAction={approvalAction.bind(null, slug, post.id, 'CHANGES_REQUESTED')} type="submit" variant="secondary">Request changes</Button></div>
            </form>}
          </article>
        ))}</div> : <p className="mt-5 rounded-md bg-surface-soft p-5">No posts are waiting for approval.</p>}
      </section>
    </>
  );
}
