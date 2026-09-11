import { describe, expect, it } from 'vitest';
import { localInputToUtc, nextOccurrence, toUtc, utcToLocalInput } from './time';

describe('timezone conversion', () => {
  it('round-trips a local wall clock through UTC', () => {
    const utc = localInputToUtc('2026-09-15T09:00', 'America/New_York');
    expect(utc.toISOString()).toBe('2026-09-15T13:00:00.000Z');
    expect(utcToLocalInput(utc, 'America/New_York')).toBe('2026-09-15T09:00');
  });

  it('keeps a weekly queue slot at local time across DST', () => {
    const before = nextOccurrence(
      new Date('2026-10-30T12:00:00Z'),
      'America/New_York',
      1,
      9,
      0,
    );
    expect(before.toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('rejects a local time skipped by the spring DST transition', () => {
    expect(() => localInputToUtc('2027-03-14T02:30', 'America/New_York')).toThrow(
      'Mar 14, 2027, 2:30 AM does not exist in Eastern Time',
    );
    expect(() => toUtc(
      { year: 2027, month: 3, day: 14, hour: 2, minute: 30 },
      'America/New_York',
    )).toThrow('Mar 14, 2027, 2:30 AM does not exist in Eastern Time');
  });

  it('names an incomplete local date-time value', () => {
    expect(() => localInputToUtc('2026-09-15', 'America/New_York')).toThrow(
      'Enter a complete local date and time.',
    );
  });
});
