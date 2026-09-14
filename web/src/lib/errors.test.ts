import { describe, expect, it } from 'vitest';
import { AppError, notFound, toAppError } from '@/lib/errors';

/** Next throws to signal redirect() and notFound(); tagged by `digest`. */
const framework = (digest: string) => Object.assign(new Error(digest), { digest });

describe('toAppError', () => {
  it('lets redirect() through instead of reporting it as a failure', () => {
    const redirect = framework('NEXT_REDIRECT;replace;/signed-out;307;');
    expect(() => toAppError(redirect)).toThrow(redirect);
  });

  it('lets notFound() through', () => {
    expect(() => toAppError(framework('NEXT_HTTP_ERROR_FALLBACK;404'))).toThrow();
    expect(() => toAppError(framework('NEXT_NOT_FOUND'))).toThrow();
  });

  it('still wraps ordinary errors as INTERNAL and keeps the detail', () => {
    const wrapped = toAppError(new Error('database is on fire'));
    expect(wrapped.code).toBe('INTERNAL');
    expect(wrapped.status).toBe(500);
    expect(wrapped.message).not.toContain('database is on fire');
    expect(wrapped.detail).toContain('database is on fire');
  });

  it('passes an AppError through unchanged', () => {
    const original = notFound();
    expect(toAppError(original)).toBe(original);
    expect(toAppError(original)).toBeInstanceOf(AppError);
  });

  it('is not fooled by a non-string or unrelated digest', () => {
    expect(toAppError(Object.assign(new Error('x'), { digest: 12345 })).code).toBe('INTERNAL');
    expect(toAppError(Object.assign(new Error('x'), { digest: 'abc123' })).code).toBe('INTERNAL');
  });
});
