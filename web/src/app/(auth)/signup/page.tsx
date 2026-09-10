import { googleEnabled } from '@/auth';
import { SignUpForm } from '../auth-form';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="auth-card">
      <p className="b88-eyebrow">Start free</p>
      <h1 className="b88-page-title mt-3">Create your account</h1>
      <p className="mb-8 mt-3">Set up the first workspace after you sign in.</p>
      <SignUpForm googleEnabled={googleEnabled} next={next} />
    </div>
  );
}
