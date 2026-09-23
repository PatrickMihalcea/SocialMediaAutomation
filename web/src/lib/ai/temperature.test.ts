import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { temperatureFor } from '@/lib/ai';

/**
 * Idea generation runs hotter than everything else, because the two settings
 * answer different questions: how adventurous the account wants to be, and how
 * much variety the task needs. A caption rewritten at 1.0 is a caption nobody
 * asked for; eight image ideas at 0.7 are the model's most typical eight.
 */
describe('temperatureFor', () => {
  it('gives idea generation a hotter band than other work', () => {
    expect(temperatureFor('IDEAS', 'BALANCED')).toBeGreaterThan(temperatureFor('CAPTION', 'BALANCED'));
  });

  it('still follows the workspace setting within that band', () => {
    expect(temperatureFor('IDEAS', 'PRECISE')).toBeLessThan(temperatureFor('IDEAS', 'BALANCED'));
    expect(temperatureFor('IDEAS', 'BALANCED')).toBeLessThan(temperatureFor('IDEAS', 'CREATIVE'));
  });

  /** Past about 1.15 the replies stop parsing into the schema and get retried. */
  it('stays inside what a structured reply survives', () => {
    for (const creativity of ['PRECISE', 'BALANCED', 'CREATIVE'] as const) {
      expect(temperatureFor('IDEAS', creativity)).toBeLessThanOrEqual(1.15);
    }
  });

  it('leaves everything else where it was', () => {
    expect(temperatureFor('CAPTION', 'PRECISE')).toBe(0.25);
    expect(temperatureFor('CAPTION', 'BALANCED')).toBe(0.7);
    expect(temperatureFor('CAPTION', 'CREATIVE')).toBe(1);
  });
});
