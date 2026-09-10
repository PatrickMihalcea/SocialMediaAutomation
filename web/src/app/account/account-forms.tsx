'use client';

import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { Avatar, Field, MediaUploader, StatusMessage } from '@/bridge88/components';
import { PendingButton } from '@/components/action-ui';
import {
  changePasswordAction,
  updateProfileAction,
} from '@/app/actions/auth';
import { firstFieldError, initialActionState, type ActionState } from '@/lib/actions/state';

function AccountActionForm({
  action,
  children,
  className,
  encType,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: (state: ActionState) => ReactNode;
  className: string;
  encType?: 'multipart/form-data';
}) {
  const [state, submit] = useActionState(action, initialActionState);
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) summaryRef.current?.focus();
  }, [state]);
  return (
    <form action={submit} className={className} encType={encType}>
      {state.error && (
        <div ref={summaryRef} tabIndex={-1}>
          <StatusMessage tone="error">{state.error}</StatusMessage>
        </div>
      )}
      {state.success && <StatusMessage tone="success">{state.success}</StatusMessage>}
      {children(state)}
    </form>
  );
}

export function ProfileForm({
  name,
  image,
}: {
  name: string;
  image: string | null;
}) {
  return (
    <AccountActionForm
      action={updateProfileAction}
      className="b88-card mt-8 grid gap-6"
      encType="multipart/form-data"
    >
      {(state) => <><div className="flex items-center gap-4">
        <Avatar name={name || 'Account'} src={image ?? undefined} size={56} />
        <div>
          <h2 className="b88-heading">Profile details</h2>
          <p className="mt-1 text-sm">Shown to workspace collaborators.</p>
        </div>
      </div>
      <Field name="name" label="Name" defaultValue={name} autoComplete="name" error={firstFieldError(state, 'name')} required />
      <div>
        <p className="b88-label mb-2">Profile image</p>
        <MediaUploader
          name="image"
          accept="image/jpeg,image/png,image/webp"
          hint="JPG · PNG · WEBP · UP TO 2 MB"
          title="Choose a profile image"
          multiple={false}
          compact
        />
      </div>
      <div className="flex justify-end">
        <PendingButton type="submit" className="w-full sm:w-auto" pendingLabel="Saving profile">
          Save profile
        </PendingButton>
      </div>
      </>}
    </AccountActionForm>
  );
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  return (
    <AccountActionForm action={changePasswordAction} className="b88-card mt-8 grid gap-6">
      {(state) => <><div>
        <h2 className="b88-heading">{hasPassword ? 'Change password' : 'Add a password'}</h2>
        <p className="mt-1 text-sm">
          {hasPassword
            ? 'Confirm your current password before choosing a new one.'
            : 'Add a password to sign in without your connected provider.'}
        </p>
      </div>
      {hasPassword && (
        <Field
          name="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
          error={firstFieldError(state, 'currentPassword')}
          required
        />
      )}
      {!hasPassword && <input type="hidden" name="currentPassword" value="" />}
      <Field
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        hint="At least 10 characters"
        error={firstFieldError(state, 'password')}
        required
      />
      <Field
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        error={firstFieldError(state, 'confirmPassword')}
        required
      />
      <div className="flex justify-end">
        <PendingButton type="submit" className="w-full sm:w-auto" pendingLabel="Updating password">
          {hasPassword ? 'Update password' : 'Add password'}
        </PendingButton>
      </div>
      </>}
    </AccountActionForm>
  );
}
