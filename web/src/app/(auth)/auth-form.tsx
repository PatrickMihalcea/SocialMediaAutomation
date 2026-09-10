'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Button, Field, StatusMessage } from '@/bridge88/components';
import {
  googleSignInAction,
  loginAction,
  signUpAction,
  forgotPasswordAction,
  resetPasswordAction,
  type FormState,
} from '@/app/actions/auth';
import { firstFieldError, initialActionState } from '@/lib/actions/state';

const initialState: FormState = initialActionState;

export function LoginForm({ next, googleEnabled }: { next?: string; googleEnabled: boolean }) {
  const [state, action, pending] = useActionState(loginAction, initialState);
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="next" value={next ?? '/w'} />
      <Field name="email" label="Email" type="email" autoComplete="email" required />
      <Field name="password" label="Password" type="password" autoComplete="current-password" required />
      {state.error && <StatusMessage tone="error">{state.error}</StatusMessage>}
      <Button type="submit" fullWidth disabled={pending}>{pending ? 'Signing in' : 'Sign in'}</Button>
      {googleEnabled && (
        <Button type="submit" formAction={googleSignInAction} variant="secondary" fullWidth disabled={pending}>
          Continue with Google
        </Button>
      )}
      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <Link href="/forgot-password" className="underline underline-offset-4">Forgot password</Link>
        <Link href="/signup" className="underline underline-offset-4">Create account</Link>
      </div>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, initialState);
  return (
    <form action={action} className="space-y-6">
      <Field name="email" label="Account email" type="email" autoComplete="email" error={firstFieldError(state, 'email')} required />
      {state.success && <StatusMessage tone="success">{state.success}</StatusMessage>}
      {state.error && !state.fields?.email && <StatusMessage tone="error">{state.error}</StatusMessage>}
      <Button type="submit" fullWidth disabled={pending}>{pending ? 'Preparing link' : 'Reset password'}</Button>
      <p className="text-center text-sm"><Link href="/login" className="underline underline-offset-4">Back to sign in</Link></p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, initialState);
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="token" value={token} />
      <Field name="password" label="New password" type="password" autoComplete="new-password" minLength={10} error={firstFieldError(state, 'password')} required />
      <Field name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" minLength={10} error={firstFieldError(state, 'confirmPassword')} required />
      {state.success && <StatusMessage tone="success">{state.success}</StatusMessage>}
      {state.error && !state.fields?.password && <StatusMessage tone="error">{state.error}</StatusMessage>}
      <Button type="submit" fullWidth disabled={pending}>{pending ? 'Updating password' : 'Set new password'}</Button>
      {state.success && <p className="text-center text-sm"><Link href="/login" className="underline underline-offset-4">Sign in</Link></p>}
    </form>
  );
}

export function SignUpForm({ googleEnabled, next }: { googleEnabled: boolean; next?: string }) {
  const [state, action, pending] = useActionState(signUpAction, initialState);
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="next" value={next ?? '/onboarding'} />
      <Field name="name" label="Your name" autoComplete="name" error={firstFieldError(state, 'name')} required />
      <Field name="email" label="Work email" type="email" autoComplete="email" error={firstFieldError(state, 'email')} required />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        hint="At least 10 characters"
        error={firstFieldError(state, 'password')}
        required
      />
      <Field name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" error={firstFieldError(state, 'confirmPassword')} required />
      {state.success && <StatusMessage tone="success">{state.success}</StatusMessage>}
      {state.error && !state.fields && <StatusMessage tone="error">{state.error}</StatusMessage>}
      <Button type="submit" fullWidth disabled={pending}>{pending ? 'Creating account' : 'Create account'}</Button>
      {googleEnabled && (
        <Button type="submit" formAction={googleSignInAction} variant="secondary" fullWidth disabled={pending}>
          Continue with Google
        </Button>
      )}
      <p className="text-center text-sm">
        Already have an account? <Link href="/login" className="underline underline-offset-4">Sign in</Link>
      </p>
    </form>
  );
}
