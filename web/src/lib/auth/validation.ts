import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'Password is too long.');

export const signUpSchema = z
  .object({
    name: z.string().trim().min(2, 'Use at least 2 characters.').max(80),
    email: z.string().trim().email('Enter a valid email address.'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters.').max(80),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string(),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export function sanitizeLoginRedirect(
  value: FormDataEntryValue | string | null | undefined,
  fallback = '/w',
): string {
  const next = String(value || fallback).trim();
  if (!next.startsWith('/') || next.startsWith('//') || /^\/login(?:[/?#]|$)/.test(next)) return fallback;
  if (/^\/(?:calendar|queue|compose|media)(?:[/?#]|$)/.test(next)) return fallback;
  return next;
}
