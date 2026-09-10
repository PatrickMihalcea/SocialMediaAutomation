import { Field } from '@/bridge88/components';
import { requireUser, listMyWorkspaces } from '@/lib/auth/guard';
import { deleteAccountAction, logoutAction } from '@/app/actions/auth';
import { ConfirmationButton, PendingButton } from '@/components/action-ui';

export default async function AccountPage() {
  const user = await requireUser();
  const workspaces = await listMyWorkspaces();
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-12 md:px-12" tabIndex={-1}>
      <div className="flex items-center justify-between"><a href={workspaces[0] ? `/w/${workspaces[0].slug}` : '/w'} className="text-xl font-[540]">Bridge88</a><form action={logoutAction}><PendingButton type="submit" variant="secondary" pendingLabel="Logging out">Log out</PendingButton></form></div>
      <p className="b88-eyebrow mt-12">Account</p><h1 className="b88-page-title mt-3">Your profile</h1>
      <section className="b88-card mt-8 space-y-6">
        <Field label="Name" value={user.name ?? ''} readOnly />
        <Field label="Email" type="email" value={user.email} readOnly />
        <p className="b88-caption">{workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}</p>
      </section>
      <section className="mt-8 rounded-lg bg-[var(--block-pink)] p-6">
        <p className="b88-caption">Danger zone</p><h2 className="b88-heading mt-2">Delete account</h2>
        <p className="mt-2">Transfer or delete every workspace you own first. This action cannot be undone.</p>
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
