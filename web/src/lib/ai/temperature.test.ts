import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { MAX_AI_TEMPERATURE, resolveTemperature } from '@/lib/ai';

/**
 * The setting used to be three names standing in for three numbers. It is the
 * number now, because the three fixed points were never the right three for
 * everybody and the whole effect of the setting is how far up the scale you
 * are.
 */
describe('resolveTemperature', () => {
  it('uses the number the workspace set', () => {
    expect(resolveTemperature({ aiTemperature: 1.05, aiCreativity: 'PRECISE' })).toBe(1.05);
  });

  it('accepts zero rather than reading it as unset', () => {
    expect(resolveTemperature({ aiTemperature: 0, aiCreativity: 'CREATIVE' })).toBe(0);
  });

  /**
   * A row written before the number existed still resolves to the temperature
   * it was already running at, rather than silently changing on deploy.
   */
  it.each([
    ['PRECISE', 0.25],
    ['BALANCED', 0.7],
    ['CREATIVE', 1],
  ] as const)('falls back to what %s used to mean', (creativity, expected) => {
    expect(resolveTemperature({ aiTemperature: null, aiCreativity: creativity })).toBe(expected);
  });

  it('falls back again for a workspace with no preferences at all', () => {
    expect(resolveTemperature(null)).toBe(0.7);
  });

  /**
   * Read straight from the database and handed to the provider, so a value
   * outside the accepted range fails the call rather than the validation.
   */
  it('clamps a stored value above the maximum', () => {
    expect(resolveTemperature({ aiTemperature: 9 })).toBe(MAX_AI_TEMPERATURE);
  });

  it('clamps a stored value below zero', () => {
    expect(resolveTemperature({ aiTemperature: -1 })).toBe(0);
  });

  it('ignores a value that is not a number', () => {
    expect(resolveTemperature({ aiTemperature: Number.NaN })).toBe(0.7);
  });
});
