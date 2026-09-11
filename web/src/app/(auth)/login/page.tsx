import { googleEnabled } from '@/auth';
import { LoginForm } from '../auth-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="auth-card">
      <p className="b88-eyebrow">Account</p>
      <h1 className="b88-page-title mt-3">Sign in</h1>
      <p className="mb-8 mt-3">Pick up where your publishing queue left off.</p>
      <LoginForm next={params.next} googleEnabled={googleEnabled} />
    </div>
  );
}
