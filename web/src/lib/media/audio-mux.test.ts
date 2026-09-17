import { describe, expect, it } from 'vitest';
import {
  buildAudioMuxPlan,
  DEFAULT_STILL_SECONDS,
  evenDimensions,
  MAX_MUX_SECONDS,
  muxDurationSeconds,
} from '@/lib/media/audio-mux';

const image = { kind: 'image' as const, bytes: Buffer.alloc(4), mimeType: 'image/png', width: 1024, height: 1536 };
const video = { ...image, kind: 'video' as const, mimeType: 'video/mp4', durationSeconds: 12 };
const track = { bytes: Buffer.alloc(4), mimeType: 'audio/mpeg', durationSeconds: 180 };

describe('muxDurationSeconds', () => {
  /** Trimming someone's footage to fit a song is a decision they did not ask for. */
  it('keeps a video at its own length and lets the audio be cut instead', () => {
    expect(muxDurationSeconds(video, track)).toBe(12);
  });

  it('gives a still the music it has left, capped so it stays postable', () => {
    expect(muxDurationSeconds(image, { ...track, durationSeconds: 8 })).toBe(8);
    expect(muxDurationSeconds(image, track)).toBe(MAX_MUX_SECONDS);
    // Starting on the chorus leaves less track behind it.
    expect(muxDurationSeconds(image, { ...track, durationSeconds: 30, startSeconds: 24 })).toBe(6);
  });

  it('falls back to a readable length when nothing measured the track', () => {
    expect(muxDurationSeconds(image, { bytes: Buffer.alloc(0), mimeType: 'audio/mpeg' })).toBe(
      DEFAULT_STILL_SECONDS,
    );
  });

  it('never exceeds what the platforms accept, however long the source', () => {
    expect(muxDurationSeconds({ ...video, durationSeconds: 600 }, track)).toBe(MAX_MUX_SECONDS);
    expect(muxDurationSeconds(image, track, 600)).toBe(MAX_MUX_SECONDS);
  });
});

describe('buildAudioMuxPlan', () => {
  /**
   * The whole point of routing this through the render plan: it maps exactly
   * one audio stream, so a video's original sound is gone without a filter
   * that has to remember to remove it.
   */
  it('carries one audio track, which is the one supplied', () => {
    const plan = buildAudioMuxPlan({ source: video, audio: track });

    expect(plan.audio?.bytes).toBe(track.bytes);
    expect(plan.clips).toHaveLength(1);
    expect(plan.clips[0].kind).toBe('video');
  });

  it('covers the still for exactly the length it computed', () => {
    const plan = buildAudioMuxPlan({ source: image, audio: { ...track, durationSeconds: 10 }, fps: 30 });

    expect(plan.totalFrames).toBe(300);
    expect(plan.segments[0]).toMatchObject({ clipIndex: 0, startFrame: 0, endFrame: 300, motion: null });
  });

  /** h264 cannot encode an odd dimension; ffmpeg fails the render rather than rounding. */
  it('rounds the frame to even dimensions', () => {
    const plan = buildAudioMuxPlan({ source: { ...image, width: 1081, height: 1921 }, audio: track });
    expect(plan.width).toBe(1080);
    expect(plan.height).toBe(1920);
    expect(evenDimensions(1, 1)).toEqual({ width: 2, height: 2 });
  });

  /**
   * A fade longer than half the clip would overlap itself, and the shortest
   * result the duration floor allows is one second.
   */
  it('never fades for longer than half of what it is fading', () => {
    for (const durationSeconds of [0.4, 1, 2, 30]) {
      const plan = buildAudioMuxPlan({ source: image, audio: { ...track, durationSeconds } });
      const seconds = plan.totalFrames / plan.fps;
      expect(plan.audio!.fadeInSeconds).toBeLessThanOrEqual(seconds / 2);
      expect(plan.audio!.fadeOutSeconds).toBeLessThanOrEqual(seconds / 2);
      expect(plan.audio!.fadeInSeconds).toBeGreaterThan(0);
    }
  });
});

describe('what publishing renders', () => {
  /**
   * The preview plays the track over a muted clip; the render replaces the
   * video's audio with that same track. They agree because the plan carries
   * exactly one audio stream — so what someone hears while choosing a start
   * point is what the post goes out with.
   */
  it('starts the track where the preview started it', () => {
    const plan = buildAudioMuxPlan({
      source: video,
      audio: { ...track, startSeconds: 42 },
    });

    expect(plan.audio?.startSeconds).toBe(42);
  });

  it('measures a still against what is left of the track after the offset', () => {
    const plan = buildAudioMuxPlan({
      source: image,
      audio: { ...track, durationSeconds: 20, startSeconds: 14 },
      fps: 30,
    });

    expect(plan.totalFrames / plan.fps).toBe(6);
  });
});
