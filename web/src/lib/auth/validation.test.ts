import { describe, expect, it } from 'vitest';
import {
  changePasswordSchema,
  passwordSchema,
  resetPasswordSchema,
  signUpSchema,
} from './validation';

describe('authentication validation', () => {
  it('enforces the documented password length', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('ten-chars!').success).toBe(true);
  });

  it('normalizes account identity fields', () => {
    const result = signUpSchema.parse({
      name: '  Ada Lovelace  ',
      email: '  ADA@example.com ',
      password: 'long-password',
      confirmPassword: 'long-password',
    });
    expect(result.name).toBe('Ada Lovelace');
    expect(result.email).toBe('ADA@example.com');
  });

  it.each([signUpSchema, resetPasswordSchema, changePasswordSchema])(
    'rejects mismatched password confirmation',
    (schema) => {
      const result = schema.safeParse({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        token: 'a-valid-token-that-is-long-enough',
        currentPassword: 'old-password',
        password: 'long-password',
        confirmPassword: 'different-password',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.flatten().fieldErrors.confirmPassword).toBeDefined();
    },
  );
});
