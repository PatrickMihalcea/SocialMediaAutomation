import Link from 'next/link';
import { Button, Field, StatusMessage } from '@/bridge88/components';
import { requireUser, listMyWorkspaces } from '@/lib/auth/guard';
import { deleteAccountAction, logoutAction } from '@/app/actions/auth';
import { ConfirmationButton, PendingButton } from '@/components/action-ui';
import { ThemePreferenceControl } from '@/components/theme-preference-control';
import { db } from '@/lib/db';
import { PasswordForm, ProfileForm } from './account-forms';
import { profileImageSrc } from '@/lib/users/profile-image-src';

export const metadata = { title: 'Account' };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const workspaces = await listMyWorkspaces();
  const { error } = await searchParams;
  const credential = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, themePreference: true },
  });
  const incomplete = workspaces.filter((workspace) => !workspace.onboardedAt);

  return (
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-12 md:px-12" tabIndex={-1}>
      <div className="flex items-center justify-between"><Link href={workspaces[0] ? `/w/${workspaces[0].slug}` : '/w'} className="text-xl font-[540]">Bridge88</Link><form action={logoutAction}><PendingButton type="submit" variant="secondary" pendingLabel="Logging out">Log out</PendingButton></form></div>
      <p className="b88-eyebrow mt-12">Account</p><h1 className="b88-page-title mt-3">Your profile</h1>
      {error === 'owned-workspaces' && (
        <StatusMessage tone="error" className="mt-6">
          Delete or transfer every workspace you own before deleting your account.
        </StatusMessage>
      )}
      {(!workspaces.length || incomplete.length > 0) && (
        <section className="mt-8 rounded-[24px] bg-[var(--block-lilac)] p-6">
          <p className="b88-caption">Setup saved</p>
          <h2 className="b88-heading mt-2">
            {incomplete.length ? 'Continue workspace setup' : 'Create your first workspace'}
          </h2>
          <p className="mt-2">Your progress is saved. Continue when you are ready.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            {incomplete.map((workspace) => (
              <Button key={workspace.id} href={`/onboarding?workspace=${encodeURIComponent(workspace.slug)}`}>
                Continue {workspace.name}
              </Button>
            ))}
            {!workspaces.length && <Button href="/onboarding">Start setup</Button>}
          </div>
        </section>
      )}
      <ProfileForm name={user.name ?? ''} image={await profileImageSrc(user.image) ?? null} />
      <section className="b88-card mt-8 space-y-3">
        <h2 className="b88-heading">Sign-in email</h2>
        <Field label="Email" type="email" value={user.email} readOnly />
        <p className="text-sm">Email changes are not supported yet. Your workspace access remains tied to this address.</p>
      </section>
      <PasswordForm hasPassword={Boolean(credential?.passwordHash)} />
      <section className="b88-card mt-8 space-y-4">
        <h2 className="b88-heading">Appearance</h2>
        <ThemePreferenceControl
          initialPreference={credential?.themePreference === 'DARK' ? 'DARK' : 'LIGHT'}
        />
      </section>
      <section className="mt-8 rounded-lg bg-[var(--block-pink)] p-6">
        <p className="b88-caption">Danger zone</p><h2 className="b88-heading mt-2">Delete account</h2>
        <p className="mt-2">Transfer or delete every workspace you own first. Deletion removes your profile and workspace memberships, signs you out, and cannot be undone.</p>
        <p className="b88-caption mt-4">{workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}</p>
        <form action={deleteAccountAction} className="mt-6">
          <ConfirmationButton
            type="submit"
            variant="secondary"
            className="w-full sm:w-auto"
            confirmMessage="Delete your account permanently?"
            pendingLabel="Deleting account"
          >
            Delete account
          </ConfirmationButton>
        </form>
      </section>
    </main>
  );
}
