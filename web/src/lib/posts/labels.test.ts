import { describe, expect, it } from 'vitest';
import { postStatusLabel } from '@/lib/posts/labels';

describe('postStatusLabel', () => {
  /**
   * "Publish now" routes through the scheduler so the publishing engine owns
   * retries and per-channel state, which leaves the row SCHEDULED. Showing that
   * word is how someone who pressed publish concludes it did not work.
   */
  it('calls a due post what it is', () => {
    expect(postStatusLabel('SCHEDULED', new Date(Date.now() - 1_000))).toBe('Posting now');
  });

  it('still calls a future post scheduled', () => {
    expect(postStatusLabel('SCHEDULED', new Date(Date.now() + 60_000))).toBe('Scheduled');
    expect(postStatusLabel('SCHEDULED', null)).toBe('Scheduled');
  });

  it('leaves every other status alone', () => {
    expect(postStatusLabel('PUBLISHED', new Date(0))).toBe('Published');
    expect(postStatusLabel('DRAFT')).toBe('Draft');
    expect(postStatusLabel('FAILED', new Date(0))).toBe('Failed');
  });
});
