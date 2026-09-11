'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import {
  changePasswordSchema,
  profileSchema,
  resetPasswordSchema,
  sanitizeLoginRedirect,
  signUpSchema,
} from '@/lib/auth/validation';
import { signIn, signOut } from '@/auth';
import { audit } from '@/lib/audit';
import { hashSecret, issueSecret } from '@/lib/crypto/tokens';
import { env, publicEnv } from '@/lib/env';
import { storage } from '@/lib/storage';
import {
  actionError,
  actionSuccess,
  type ActionState,
} from '@/lib/actions/state';

export type FormState = ActionState;

export async function updateThemePreferenceAction(formData: FormData): Promise<void> {
  const { requireUser } = await import('@/lib/auth/guard');
  const user = await requireUser();
  const themePreference = z.enum(['LIGHT', 'DARK', 'SYSTEM']).parse(formData.get('themePreference'));
  await db.user.update({ where: { id: user.id }, data: { themePreference } });
  revalidatePath('/', 'layout');
}

export async function signUpAction(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return actionError(parsed.error);
  const email = parsed.data.email.toLowerCase().trim();
  const next = sanitizeLoginRedirect(formData.get('next'), '/onboarding');
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    return { status: 'error', error: 'An account already uses that email. Sign in instead.' };
  }
  let user;
  try {
    user = await db.user.create({
      data: {
        name: parsed.data.name,
        email,
        passwordHash: await hashPassword(parsed.data.password),
        emailVerified: env.MOCK_MODE ? new Date() : null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { status: 'error', error: 'An account already uses that email. Sign in instead.' };
    }
    throw error;
  }
  await audit({ userId: user.id, action: 'user.created', entityType: 'user', entityId: user.id });
  if (!env.MOCK_MODE) {
    const { secret, hash } = issueSecret();
    await db.authToken.create({
      data: {
        tokenHash: hash,
        email,
        purpose: 'EMAIL_VERIFICATION',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const verifyUrl = `${publicEnv.appUrl}/verify-email?token=${secret}&next=${encodeURIComponent(next)}`;
    if (env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: email,
          subject: 'Verify your Bridge88 email',
          html: `<p><a href="${verifyUrl}">Verify your email</a></p>`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } else {
      console.info(`[auth] email verification: ${verifyUrl}`);
    }
    return actionSuccess('Account created. Check your email to verify it.');
  }
  await signIn('credentials', { email, password: parsed.data.password, redirectTo: next });
  return {};
}

export async function loginAction(_state: FormState, formData: FormData): Promise<FormState> {
  const next = sanitizeLoginRedirect(formData.get('next'));
  try {
    await signIn('credentials', {
      email: String(formData.get('email') || ''),
      password: String(formData.get('password') || ''),
      redirectTo: next,
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: 'error', error: 'Email or password is incorrect.' };
    }
    throw error;
  }
}

export async function googleSignInAction(formData: FormData) {
  await signIn('google', { redirectTo: sanitizeLoginRedirect(formData.get('next')) });
}

export async function logoutAction() {
  await signOut({ redirectTo: '/login' });
}

export async function switchAccountAction(next: string) {
  const safeNext = sanitizeLoginRedirect(next);
  await signOut({ redirectTo: `/login?next=${encodeURIComponent(safeNext)}` });
}

export async function deleteAccountAction() {
  const { requireUser } = await import('@/lib/auth/guard');
  const user = await requireUser();
  const owned = await db.workspaceMember.count({ where: { userId: user.id, role: 'OWNER' } });
  if (owned) redirect('/account?error=owned-workspaces');
  const profileKey = managedProfileKey(user.image, user.id);
  await db.user.delete({ where: { id: user.id } });
  if (profileKey) await storage().delete(profileKey).catch(() => undefined);
  await signOut({ redirectTo: '/' });
}

export async function updateProfileAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  let uploadedKey: string | null = null;
  try {
    const { requireUser } = await import('@/lib/auth/guard');
    const user = await requireUser();
    const input = profileSchema.parse(Object.fromEntries(formData));
    const image = formData.get('image');
    let imageUrl: string | undefined;

    if (image instanceof File && image.size) {
      const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
      if (!allowed.has(image.type)) {
        return { status: 'error', error: 'Use a JPG, PNG, or WebP profile image.' };
      }
      if (image.size > 2 * 1024 * 1024) {
        return { status: 'error', error: 'The profile image must be 2 MB or smaller.' };
      }
      const ext = image.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
      uploadedKey = `users/${user.id}/profile/${randomUUID()}.${ext}`;
      await storage().put(uploadedKey, Buffer.from(await image.arrayBuffer()), image.type);
      imageUrl = await storage().signedUrl(uploadedKey, 365 * 24 * 60 * 60);
    }

    await db.user.update({
      where: { id: user.id },
      data: { name: input.name, ...(imageUrl ? { image: imageUrl } : {}) },
    });
    const previousKey = imageUrl ? managedProfileKey(user.image, user.id) : null;
    if (previousKey) await storage().delete(previousKey).catch(() => undefined);
    await audit({
      userId: user.id,
      action: 'user.profile_updated',
      entityType: 'user',
      entityId: user.id,
      metadata: { imageUpdated: Boolean(imageUrl) },
    });
    revalidatePath('/account');
    return actionSuccess(imageUrl ? 'Profile and image updated.' : 'Profile updated.');
  } catch (error) {
    if (uploadedKey) await storage().delete(uploadedKey).catch(() => undefined);
    return actionError(error, 'The profile could not be updated.');
  }
}

export async function changePasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { requireUser } = await import('@/lib/auth/guard');
    const user = await requireUser();
    const input = changePasswordSchema.parse(Object.fromEntries(formData));
    const record = await db.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!record) return { status: 'error', error: 'Your session is no longer valid. Sign in again.' };
    if (record.passwordHash && !(await verifyPassword(input.currentPassword, record.passwordHash))) {
      return { status: 'error', error: 'Current password is incorrect.' };
    }
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.password) },
    });
    await audit({
      userId: user.id,
      action: 'user.password_updated',
      entityType: 'user',
      entityId: user.id,
    });
    return actionSuccess('Password updated.');
  } catch (error) {
    return actionError(error, 'The password could not be updated.');
  }
}

export async function forgotPasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = z
    .object({ email: z.string().email('Enter a valid email address.') })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return actionError(parsed.error);
  const email = parsed.data.email.toLowerCase();
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    const { secret, hash } = issueSecret();
    await db.authToken.deleteMany({ where: { email, purpose: 'PASSWORD_RESET', usedAt: null } });
    await db.authToken.create({
      data: {
        tokenHash: hash,
        email,
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const resetUrl = `${publicEnv.appUrl}/reset-password?token=${secret}`;
    if (env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: email,
          subject: 'Reset your Bridge88 password',
          html: `<p><a href="${resetUrl}">Reset your password</a></p>`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    }
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[auth] password reset: ${resetUrl}`);
    }
  }
  return actionSuccess('If that account exists, a reset link has been prepared.');
}

export async function resetPasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return actionError(parsed.error);
  const token = await db.authToken.findUnique({
    where: { tokenHash: hashSecret(parsed.data.token) },
  });
  if (!token || token.purpose !== 'PASSWORD_RESET' || token.usedAt || token.expiresAt < new Date()) {
    return { status: 'error', error: 'This reset link has expired or was already used.' };
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const updated = await db.$transaction(async (transaction) => {
    const claimed = await transaction.authToken.updateMany({
      where: {
        id: token.id,
        purpose: 'PASSWORD_RESET',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return false;
    await transaction.user.update({
      where: { email: token.email },
      data: { passwordHash },
    });
    return true;
  });
  if (!updated) {
    return { status: 'error', error: 'This reset link has expired or was already used.' };
  }
  return actionSuccess('Password updated. You can sign in now.');
}

export async function verifyEmailToken(tokenValue: string): Promise<boolean> {
  if (!tokenValue) return false;
  const token = await db.authToken.findUnique({ where: { tokenHash: hashSecret(tokenValue) } });
  if (!token || token.purpose !== 'EMAIL_VERIFICATION' || token.usedAt || token.expiresAt < new Date()) {
    return false;
  }
  await db.$transaction([
    db.user.update({ where: { email: token.email }, data: { emailVerified: new Date() } }),
    db.authToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
  ]);
  return true;
}

export async function passwordResetTokenIsValid(tokenValue: string): Promise<boolean> {
  if (!tokenValue) return false;
  const token = await db.authToken.findUnique({
    where: { tokenHash: hashSecret(tokenValue) },
    select: { purpose: true, usedAt: true, expiresAt: true },
  });
  return Boolean(
    token &&
    token.purpose === 'PASSWORD_RESET' &&
    !token.usedAt &&
    token.expiresAt > new Date(),
  );
}

function managedProfileKey(imageUrl: string | null, userId: string): string | null {
  if (!imageUrl) return null;
  try {
    const path = decodeURIComponent(new URL(imageUrl, publicEnv.appUrl).pathname);
    const prefix = `users/${userId}/profile/`;
    const start = path.indexOf(prefix);
    return start >= 0 ? path.slice(start) : null;
  } catch {
    return null;
  }
}
