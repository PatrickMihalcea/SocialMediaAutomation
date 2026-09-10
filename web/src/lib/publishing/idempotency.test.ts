import { describe, expect, it } from 'vitest';
import { idempotencyKey } from './idempotency';

describe('publishing idempotency', () => {
  it('is stable for retries of one post and channel', () => {
    expect(idempotencyKey('post-a', 'account-a')).toBe(idempotencyKey('post-a', 'account-a'));
  });

  it('differs across channels and posts', () => {
    expect(idempotencyKey('post-a', 'account-a')).not.toBe(idempotencyKey('post-a', 'account-b'));
    expect(idempotencyKey('post-a', 'account-a')).not.toBe(idempotencyKey('post-b', 'account-a'));
  });
});
