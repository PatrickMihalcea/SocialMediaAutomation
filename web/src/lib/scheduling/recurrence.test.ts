import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { occurrencesBetween } from './recurrence';

describe('recurring schedules', () => {
  it('materializes only matching weekdays inside the requested window', () => {
    const result = occurrencesBetween({
      from: DateTime.fromISO('2026-09-01T00:00:00Z'),
      until: DateTime.fromISO('2026-09-15T23:59:00Z'),
      weekdays: [2, 4],
      hour: 17,
      minute: 0,
      timezone: 'America/New_York',
    });
    expect(result).toHaveLength(5);
    expect(result[0].toISOString()).toBe('2026-09-01T21:00:00.000Z');
    expect(result.at(-1)?.toISOString()).toBe('2026-09-15T21:00:00.000Z');
  });

  it('supports the every-weekday preset', () => {
    const result = occurrencesBetween({
      from: DateTime.fromISO('2026-09-10T00:00:00Z'),
      until: DateTime.fromISO('2026-09-14T23:59:00Z'),
      weekdays: [],
      hour: 9,
      minute: 0,
      timezone: 'America/New_York',
      frequency: 'weekdays',
    });
    expect(result.map((date) => date.toISOString())).toEqual([
      '2026-09-10T13:00:00.000Z',
      '2026-09-11T13:00:00.000Z',
      '2026-09-14T13:00:00.000Z',
    ]);
  });

  it('supports monthly schedules and skips months without that day', () => {
    const result = occurrencesBetween({
      from: DateTime.fromISO('2026-01-01T00:00:00Z'),
      until: DateTime.fromISO('2026-04-30T23:59:00Z'),
      weekdays: [],
      hour: 9,
      minute: 0,
      timezone: 'UTC',
      frequency: 'monthly',
      monthDay: 31,
    });
    expect(result.map((date) => date.toISOString())).toEqual([
      '2026-01-31T09:00:00.000Z',
      '2026-03-31T09:00:00.000Z',
    ]);
  });
});
