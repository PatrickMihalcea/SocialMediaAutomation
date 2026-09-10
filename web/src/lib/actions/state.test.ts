import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { actionError, actionSuccess, firstFieldError } from '@/lib/actions/state';
import { invalid } from '@/lib/errors';

describe('action state helpers', () => {
  it('turns validation failures into field errors', () => {
    const result = z.object({ email: z.string().email('Enter a valid email.') }).safeParse({
      email: 'not-an-email',
    });
    if (result.success) throw new Error('Expected validation to fail');

    const state = actionError(result.error);
    expect(state.status).toBe('error');
    expect(firstFieldError(state, 'email')).toBe('Enter a valid email.');
  });

  it('preserves safe application errors and success messages', () => {
    expect(actionError(invalid('Check this value.')).error).toBe('Check this value.');
    expect(actionSuccess('Saved.')).toEqual({ status: 'success', success: 'Saved.' });
  });
});
