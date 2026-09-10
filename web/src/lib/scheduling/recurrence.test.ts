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
});
