import { describe, expect, it } from 'vitest';
import {
  AudioStartError,
  formatSeconds,
  parseAudioStart,
  roundToMilliseconds,
} from '@/lib/media/audio-start';

describe('parseAudioStart', () => {
  it('reads a plain number of seconds', () => {
    expect(parseAudioStart('12.5')).toBe(12.5);
  });

  it('keeps three decimal places', () => {
    expect(parseAudioStart('12.345')).toBe(12.345);
  });

  it('rounds a fourth decimal place away rather than storing it', () => {
    expect(parseAudioStart('12.3456')).toBe(12.346);
    expect(parseAudioStart('12.3454')).toBe(12.345);
  });

  it('distinguishes an unset value from a deliberate zero', () => {
    expect(parseAudioStart('')).toBeNull();
    expect(parseAudioStart('   ')).toBeNull();
    expect(parseAudioStart(null)).toBeNull();
    expect(parseAudioStart(undefined)).toBeNull();
    expect(parseAudioStart('0')).toBe(0);
  });

  it('rejects text and other non-numbers', () => {
    expect(() => parseAudioStart('soon')).toThrow(AudioStartError);
    expect(() => parseAudioStart('NaN')).toThrow(AudioStartError);
  });

  it('rejects a negative start', () => {
    expect(() => parseAudioStart('-1')).toThrow(/cannot be negative/);
  });

  it('rejects a start beyond the hour bound', () => {
    expect(() => parseAudioStart('3601')).toThrow(/within the first hour/);
    expect(parseAudioStart('3600')).toBe(3_600);
  });

  it('rejects a start at or past the end of a known track', () => {
    expect(() => parseAudioStart('30', { duration: 30 })).toThrow(/before the end/);
    expect(() => parseAudioStart('31', { duration: 30 })).toThrow(/before the end/);
    expect(parseAudioStart('29.999', { duration: 30 })).toBe(29.999);
  });

  it('skips the duration check when the length is unknown', () => {
    // An un-analysed upload has no duration yet; that must not block saving a
    // start point, because the number is usually known before the analysis is.
    expect(parseAudioStart('45', { duration: null })).toBe(45);
    expect(parseAudioStart('45', { duration: 0 })).toBe(45);
  });
});

describe('roundToMilliseconds', () => {
  it('snaps to the grid the number input offers', () => {
    // The case that motivates the helper: this is not representable in binary
    // floating point and reads back as 12.344999999999999 without the round.
    expect(roundToMilliseconds(12.345)).toBe(12.345);
    expect(roundToMilliseconds(0.1 + 0.2)).toBe(0.3);
  });
});

describe('formatSeconds', () => {
  it('writes minutes and seconds', () => {
    expect(formatSeconds(83)).toBe('1:23');
    expect(formatSeconds(5)).toBe('0:05');
  });

  it('includes milliseconds only when there are any', () => {
    expect(formatSeconds(83.5)).toBe('1:23.500');
    expect(formatSeconds(83)).toBe('1:23');
  });

  it('does not produce a negative clock', () => {
    expect(formatSeconds(-4)).toBe('0:00');
  });
});
