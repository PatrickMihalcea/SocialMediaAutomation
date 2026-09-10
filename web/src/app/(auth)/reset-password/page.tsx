import { Button } from '@/bridge88/components';
import { passwordResetTokenIsValid } from '@/app/actions/auth';
import { ResetPasswordForm } from '../auth-form';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? '';
  const valid = await passwordResetTokenIsValid(token);
  return (
    <div className="auth-card">
      <p className="b88-eyebrow">Account recovery</p>
      <h1 className="b88-page-title mt-3">{valid ? 'Choose a new password' : 'Reset link unavailable'}</h1>
      <p className="mb-8 mt-3">
        {valid
          ? 'Use at least 10 characters.'
          : 'This link expired, was already used, or is incomplete. Request a new single-use link.'}
      </p>
      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="grid gap-3">
          <Button href="/forgot-password" fullWidth>Request a new link</Button>
          <Button href="/login" variant="secondary" fullWidth>Back to sign in</Button>
        </div>
      )}
    </div>
  );
}
