import { Button } from '@/bridge88/components';
import { sanitizeLoginRedirect, verifyEmailToken } from '@/app/actions/auth';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; next?: string }>;
}) {
  const { token, next } = await searchParams;
  const verified = token ? await verifyEmailToken(token) : null;
  const loginHref = `/login?next=${encodeURIComponent(sanitizeLoginRedirect(next, '/onboarding'))}`;
  return (
    <div className="auth-card">
      <p className="b88-eyebrow">Email verification</p>
      <h1 className="b88-page-title mt-3">
        {verified === true ? 'Email verified' : verified === false ? 'Link expired' : 'Check your inbox'}
      </h1>
      <p className="mt-4">
        {verified === true
          ? 'Your account is ready. Sign in to create a workspace.'
          : verified === false
            ? 'This verification link has expired or was already used.'
            : 'Open the single-use link in the verification email. The link expires after 24 hours.'}
      </p>
      <Button href={verified === true ? loginHref : '/login'} className="mt-8">Back to sign in</Button>
    </div>
  );
}
