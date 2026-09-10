import { describe, expect, it } from 'vitest';
import { percentageChange, previousRange, resolveAnalyticsRange } from './range';

const NOW = new Date('2026-09-10T16:00:00.000Z');

describe('resolveAnalyticsRange', () => {
  it('defaults to the last 30 inclusive UTC days', () => {
    const range = resolveAnalyticsRange({}, NOW);
    expect(range.preset).toBe('30d');
    expect(range.from.toISOString()).toBe('2026-08-12T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-09-10T23:59:59.999Z');
  });

  it('rejects an inverted custom range', () => {
    const range = resolveAnalyticsRange({ range: 'custom', from: '2026-09-10', to: '2026-09-01' }, NOW);
    expect(range.error).toBe('The start date must be before the end date.');
  });

  it('builds an immediately preceding comparison range', () => {
    const current = resolveAnalyticsRange({ range: '7d' }, NOW);
    const previous = previousRange(current);
    expect(previous.from.toISOString()).toBe('2026-08-28T00:00:00.000Z');
    expect(previous.to.toISOString()).toBe('2026-09-03T23:59:59.999Z');
  });
});

describe('percentageChange', () => {
  it('formats positive and negative comparisons', () => {
    expect(percentageChange(120, 100)).toBe('+20.0%');
    expect(percentageChange(75, 100)).toBe('-25.0%');
  });

  it('does not invent a percentage without a baseline', () => {
    expect(percentageChange(5, 0)).toBeUndefined();
    expect(percentageChange(null, 2)).toBeUndefined();
  });
});
