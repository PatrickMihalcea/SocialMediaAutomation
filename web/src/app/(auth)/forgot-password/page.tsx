import { ForgotPasswordForm } from '../auth-form';

export default function ForgotPasswordPage() {
  return (
    <div className="auth-card">
      <p className="b88-eyebrow">Account recovery</p>
      <h1 className="b88-page-title mt-3">Reset your password</h1>
      <p className="mb-8 mt-3">Reset links expire after one hour and can be used once.</p>
      <ForgotPasswordForm />
    </div>
  );
}
