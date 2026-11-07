import { describe, expect, it } from 'vitest';
import { classifyHttp } from '@/lib/social/errors';

const meta = (code: number, message = 'x') => JSON.stringify({ error: { code, message } });

describe('reading a Meta 400', () => {
  it('treats throttling as something to retry, not a rejection', () => {
    const error = classifyHttp('FACEBOOK', 400, meta(4, 'Application request limit reached'));
    expect(error.code).toBe('RATE_LIMIT');
    expect(error.retryable).toBe(true);
    expect(classifyHttp('INSTAGRAM', 400, meta(80002)).code).toBe('RATE_LIMIT');
  });

  it('says a deleted post was not found', () => {
    const error = classifyHttp('INSTAGRAM', 400, meta(100, "Object with ID '1' does not exist, cannot be loaded"));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.retryable).toBe(false);
  });

  it('still rejects anything else', () => {
    expect(classifyHttp('FACEBOOK', 400, meta(100, 'Invalid parameter')).code).toBe('REJECTED');
    // Other networks' bodies are not read as Meta's.
    expect(classifyHttp('LINKEDIN', 400, meta(4)).code).toBe('REJECTED');
  });
});
