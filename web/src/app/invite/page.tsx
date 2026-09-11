import Link from 'next/link';
import { Button } from '@/bridge88/components';
import { getCurrentUser } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { hashSecret } from '@/lib/crypto/tokens';
import { acceptInviteAction } from '@/app/actions/team';
import { switchAccountAction } from '@/app/actions/auth';
import { PendingButton } from '@/components/action-ui';

export const metadata = { title: 'Workspace invitation' };

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token = '', error } = await searchParams;
  const user = await getCurrentUser();
  const invite = token
    ? await db.workspaceInvite.findUnique({
        where: { tokenHash: hashSecret(token) },
        include: { workspace: true, invitedBy: { select: { name: true, email: true } } },
      })
    : null;
  const valid = invite && !invite.acceptedAt && invite.expiresAt > new Date();

  return (
    <main id="main-content" className="mx-auto flex min-h-screen max-w-2xl items-center px-6 py-16">
      <section className="w-full rounded-lg bg-[var(--block-lilac)] p-8 sm:p-12">
        <p className="b88-eyebrow">Workspace invitation</p>
        <h1 className="b88-page-title mt-3">{valid ? `Join ${invite.workspace.name}` : 'Invitation unavailable'}</h1>
        {valid ? (
          <>
            <p className="mt-4">{invite.invitedBy.name ?? invite.invitedBy.email} invited {invite.email} as {invite.role.toLowerCase()}.</p>
            {!user ? (
              <div className="mt-7 flex flex-wrap gap-3">
                <Button href={`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`}>Sign in to accept</Button>
                <Button href={`/signup?next=${encodeURIComponent(`/invite?token=${token}`)}`} variant="secondary">Create account</Button>
              </div>
            ) : user.email.toLowerCase() !== invite.email.toLowerCase() ? (
              <div className="mt-6 rounded-md bg-canvas p-4">
                <p>Sign in as {invite.email} to accept this invitation.</p>
                <form action={switchAccountAction.bind(null, `/invite?token=${token}`)} className="mt-4">
                  <PendingButton type="submit" variant="secondary" pendingLabel="Signing out">
                    Switch account
                  </PendingButton>
                </form>
              </div>
            ) : (
              <form action={acceptInviteAction.bind(null, token)} className="mt-7">
                <PendingButton type="submit" pendingLabel="Joining workspace">Accept invitation</PendingButton>
              </form>
            )}
          </>
        ) : (
          <p className="mt-4">{error === 'email' ? 'This invitation belongs to another email address.' : 'This link expired, was revoked, or was already used.'} Ask a workspace admin to resend it.</p>
        )}
        <Link href="/" className="mt-8 inline-block font-[480]">Back to Bridge88</Link>
      </section>
    </main>
  );
}
