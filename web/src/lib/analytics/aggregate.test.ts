import { describe, expect, it } from 'vitest';
import { sumReported } from './aggregate';

describe('sumReported', () => {
  it('keeps entirely missing metrics null', () => {
    expect(sumReported([null, null])).toBeNull();
  });

  it('sums only values platforms reported', () => {
    expect(sumReported([4, null, 6])).toBe(10);
    expect(sumReported([0, null])).toBe(0);
  });
});
