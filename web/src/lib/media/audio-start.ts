/**
 * Parsing and rounding for an audio start point.
 *
 * One place, because the same number is typed into the media library, typed
 * again into the composer, and read back by the renderer — and the three only
 * agree if they round identically. Milliseconds is the resolution: it is what
 * separates starting on the beat from starting just after it, and it is what
 * the number inputs offer with step="0.001".
 */

/** Longest track worth a start offset; also the composer's existing bound. */
export const MAX_AUDIO_START_SECONDS = 3_600;

export class AudioStartError extends Error {}

/**
 * Milliseconds, as an integer number of them.
 *
 * Rounding here rather than at the point of display is what stops a typed
 * 12.345 coming back as 12.344999999999999 — binary floats cannot hold it, so
 * the value is snapped to the grid the input actually offers before it is
 * stored, and every later read is exact.
 */
export function roundToMilliseconds(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * A start point out of whatever the form sent.
 *
 * Empty means "not set" and returns null — distinct from 0, which is somebody
 * deliberately saying the track starts at its beginning. Callers that treat
 * those the same lose the ability to tell "never chosen" from "chosen as zero".
 */
export function parseAudioStart(
  value: FormDataEntryValue | string | null | undefined,
  options: { duration?: number | null } = {},
): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new AudioStartError('The start point must be a number of seconds.');
  }
  if (parsed < 0) {
    throw new AudioStartError('The start point cannot be negative.');
  }

  const rounded = roundToMilliseconds(parsed);
  if (rounded > MAX_AUDIO_START_SECONDS) {
    throw new AudioStartError('The start point must be within the first hour of the track.');
  }

  // Checked against the track's own length when it is known. A start past the
  // end renders silence, and silence that took a full encode to discover is a
  // worse error than this one.
  const duration = options.duration;
  if (typeof duration === 'number' && duration > 0 && rounded >= duration) {
    throw new AudioStartError(
      `The start point must be before the end of the track (${formatSeconds(duration)}).`,
    );
  }
  return rounded;
}

/** `1:23.500`, for messages and captions. Minutes, because tracks are minutes long. */
export function formatSeconds(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = roundToMilliseconds(safe - minutes * 60);
  const whole = Math.floor(rest);
  const millis = Math.round((rest - whole) * 1000);
  const padded = String(whole).padStart(2, '0');
  return millis ? `${minutes}:${padded}.${String(millis).padStart(3, '0')}` : `${minutes}:${padded}`;
}
