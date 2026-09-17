import { describe, expect, it } from 'vitest';
import { BeatPlanError, buildBeatPlan } from '@/lib/render/plan';
import type { BeatGrid } from '@/lib/audio/types';

/** An even grid at a given tempo, the shape a quantised track produces. */
function grid(bpm: number, beatCount: number, overrides: Partial<BeatGrid> = {}): BeatGrid {
  const interval = 60 / bpm;
  const beats = Array.from({ length: beatCount }, (_, i) => Number((i * interval).toFixed(6)));
  return {
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    beatStrength: [],
    bpm,
    beatsPerBar: 4,
    durationSeconds: beatCount * interval,
    confidence: 1,
    analyzer: 'test',
    version: 1,
    ...overrides,
  };
}

describe('buildBeatPlan', () => {
  it('cuts every N beats and tiles the timeline exactly', () => {
    const plan = buildBeatPlan({ grid: grid(120, 128), imageCount: 8, beatsPerClip: 8, fps: 30 });

    expect(plan.durations).toHaveLength(8);
    // 8 beats at 120bpm = 4s = 120 frames at 30fps.
    expect(plan.durations.every((d) => d === 120)).toBe(true);
    expect(plan.totalFrames).toBe(960);
    // The invariant every overlay range depends on.
    expect(plan.durations.reduce((a, b) => a + b, 0)).toBe(plan.totalFrames);
    expect(plan.adjustment).toBe('none');
  });

  it('produces variable durations on a grid that is not perfectly even', () => {
    const uneven = grid(120, 64);
    // Nudge one beat late, the way a live recording drifts.
    uneven.beats[8] = uneven.beats[8] + 0.2;
    const plan = buildBeatPlan({ grid: uneven, imageCount: 4, beatsPerClip: 4, fps: 30 });

    const distinct = new Set(plan.durations);
    expect(distinct.size).toBeGreaterThan(1);
    expect(plan.durations.reduce((a, b) => a + b, 0)).toBe(plan.totalFrames);
  });

  it('keeps cut frames strictly increasing', () => {
    const plan = buildBeatPlan({ grid: grid(200, 128), imageCount: 8, beatsPerClip: 1, fps: 24 });
    for (let i = 1; i < plan.cutFrames.length; i++) {
      expect(plan.cutFrames[i]).toBeGreaterThan(plan.cutFrames[i - 1]);
    }
  });

  it('starts on a downbeat, not on whatever beat is nearest', () => {
    const plan = buildBeatPlan({
      grid: grid(120, 64),
      imageCount: 4,
      beatsPerClip: 4,
      fps: 30,
      startSeconds: 3.2, // between downbeats at 2.0 and 4.0
    });
    expect(plan.startBeatIndex % 4).toBe(0);
  });

  /**
   * The contract the saved start point on a track depends on. Drop-finding is a
   * guess from onset strength; a start somebody chose by ear is not, so the
   * explicit value has to win even when the automatic rule would have skipped
   * well past it. Without this, setting a start on a track with a quiet intro
   * would look like it had been ignored.
   */
  it('honours an explicit start over the drop it would otherwise find', () => {
    const withIntro = grid(120, 64);
    withIntro.beatStrength = withIntro.beats.map((_, i) => (i < 16 ? 0.05 : 1));

    const plan = buildBeatPlan({
      grid: withIntro,
      imageCount: 4,
      beatsPerClip: 4,
      fps: 30,
      // 2.0s is beat 4 at 120bpm — a downbeat inside the quiet intro.
      startSeconds: 2,
    });

    expect(plan.startBeatIndex).toBe(4);
    expect(plan.audioStartSeconds).toBeCloseTo(2, 6);
  });

  it('skips a quiet intro and starts on the drop', () => {
    const withIntro = grid(120, 64);
    // First sixteen beats near-silent, then the track arrives.
    withIntro.beatStrength = withIntro.beats.map((_, i) => (i < 16 ? 0.05 : 1));

    const plan = buildBeatPlan({ grid: withIntro, imageCount: 4, beatsPerClip: 4, fps: 30 });
    expect(plan.startBeatIndex).toBeGreaterThanOrEqual(16);
  });

  it('halves the clip length rather than dropping images when beats run short', () => {
    // 40 beats available, 8 images at 8 beats each would need 64.
    const plan = buildBeatPlan({ grid: grid(120, 41), imageCount: 8, beatsPerClip: 8, fps: 30 });

    expect(plan.imageCount).toBe(8);
    expect(plan.beatsPerClip).toBeLessThan(8);
    expect(['halved-beats', 'extrapolated', 'earlier-start']).toContain(plan.adjustment);
  });

  it('drops images only as a last resort, and says so', () => {
    // A very short grid with no room left to extrapolate into.
    const short = grid(120, 6, { durationSeconds: 3 });
    const plan = buildBeatPlan({ grid: short, imageCount: 8, beatsPerClip: 4, fps: 30 });

    expect(plan.imageCount).toBeLessThan(8);
    expect(plan.adjustment).toBe('dropped-images');
    expect(plan.durations).toHaveLength(plan.imageCount);
  });

  it('extrapolates past the last detected beat when the track continues', () => {
    // Grid stops at 30s but the file runs to 120s — librosa lost the outro.
    const truncated = grid(120, 61, { durationSeconds: 120 });
    const plan = buildBeatPlan({ grid: truncated, imageCount: 8, beatsPerClip: 8, fps: 30 });

    expect(plan.imageCount).toBe(8);
    expect(plan.beatsPerClip).toBe(8);
    expect(plan.adjustment).toBe('extrapolated');
  });

  it('never extrapolates past the end of the file', () => {
    const truncated = grid(120, 20, { durationSeconds: 10 });
    const plan = buildBeatPlan({ grid: truncated, imageCount: 8, beatsPerClip: 8, fps: 30 });
    expect(plan.totalSeconds).toBeLessThanOrEqual(10);
  });

  it('applies visual lead by shifting the audio later, not the cuts earlier', () => {
    const base = buildBeatPlan({ grid: grid(120, 128), imageCount: 4, beatsPerClip: 4, fps: 30 });
    const led = buildBeatPlan({
      grid: grid(120, 128),
      imageCount: 4,
      beatsPerClip: 4,
      fps: 30,
      visualLeadMs: 30,
    });
    expect(led.audioStartSeconds).toBeCloseTo(base.audioStartSeconds + 0.03, 6);
    expect(led.cutFrames).toEqual(base.cutFrames);
  });

  it('is deterministic: same input, same plan', () => {
    const input = { grid: grid(128, 200), imageCount: 7, beatsPerClip: 8, fps: 30 };
    expect(buildBeatPlan(input)).toEqual(buildBeatPlan(input));
  });

  it('refuses a grid with nothing in it rather than guessing', () => {
    expect(() => buildBeatPlan({ grid: grid(120, 1), imageCount: 4, beatsPerClip: 4, fps: 30 }))
      .toThrow(BeatPlanError);
  });

  it('refuses to build a video from no images', () => {
    expect(() => buildBeatPlan({ grid: grid(120, 64), imageCount: 0, beatsPerClip: 4, fps: 30 }))
      .toThrow(BeatPlanError);
  });
});
