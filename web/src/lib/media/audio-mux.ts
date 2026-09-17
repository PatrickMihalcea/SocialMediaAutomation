import type { RenderPlan } from '@/lib/render/types';

/**
 * Putting a soundtrack on a post's media.
 *
 * Worth being clear about what this is, because the platforms are not: none of
 * their publishing APIs has a "music" parameter. The track people pick inside
 * Instagram or TikTok is attached by those apps, from those apps' licensed
 * libraries, and nothing an API client sends can reproduce it. What an API can
 * publish is a video whose audio track is the music — so that is what this
 * builds, and a still with a soundtrack becomes a video, because there is no
 * other shape a platform will carry it in.
 *
 * The replacement of any existing audio is not a separate step: the render plan
 * maps exactly one audio stream, its own, so whatever the source video carried
 * is simply not in the output.
 *
 * Pure — no ffmpeg, no storage, no database — so the arithmetic below is
 * testable on a machine with neither installed.
 */

/** Instagram Reels and TikTok both stop accepting well before this. */
export const MAX_MUX_SECONDS = 90;
/** Long enough to read a still, short enough that nobody scrolls past it. */
export const DEFAULT_STILL_SECONDS = 15;
/** Cutting mid-waveform clicks; the render plan fades both ends. */
const FADE_SECONDS = 0.35;

export interface MuxSource {
  kind: 'image' | 'video';
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
  /** Videos only. A still has no length of its own. */
  durationSeconds?: number | null;
}

export interface MuxAudio {
  bytes: Buffer;
  mimeType: string;
  durationSeconds?: number | null;
  /** Seconds into the track, for starting on a chorus rather than an intro. */
  startSeconds?: number;
}

/**
 * How long the result runs.
 *
 * A video keeps its own length — trimming someone's footage to fit a song is a
 * decision they did not ask for, and the plan trims the audio to the video
 * instead. A still has no length, so it takes the music's, capped: a four
 * minute track behind one photograph is not a post anyone will watch, and the
 * platforms would reject it anyway.
 */
export function muxDurationSeconds(
  source: MuxSource,
  audio: MuxAudio,
  requestedSeconds?: number | null,
): number {
  if (source.kind === 'video' && source.durationSeconds) {
    return Math.min(source.durationSeconds, MAX_MUX_SECONDS);
  }
  const remainingAudio = audio.durationSeconds
    ? Math.max(0, audio.durationSeconds - (audio.startSeconds ?? 0))
    : null;
  const wanted = requestedSeconds || remainingAudio || DEFAULT_STILL_SECONDS;
  return Math.max(1, Math.min(wanted, MAX_MUX_SECONDS));
}

/**
 * Even dimensions, because h264 chroma subsampling has no way to encode an odd
 * one and ffmpeg fails the whole render rather than rounding for you.
 */
export function evenDimensions(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(2, width - (width % 2)), height: Math.max(2, height - (height % 2)) };
}

export function buildAudioMuxPlan(input: {
  source: MuxSource;
  audio: MuxAudio;
  fps?: number;
  requestedSeconds?: number | null;
}): RenderPlan {
  const fps = input.fps ?? 30;
  const seconds = muxDurationSeconds(input.source, input.audio, input.requestedSeconds);
  const { width, height } = evenDimensions(input.source.width, input.source.height);
  const totalFrames = Math.max(1, Math.round(seconds * fps));
  // Half the clip at most, so a short result still fades rather than clicking.
  const fade = Math.min(FADE_SECONDS, seconds / 2);

  return {
    width,
    height,
    fps,
    totalFrames,
    supersample: 1,
    clips: [
      {
        kind: input.source.kind,
        bytes: input.source.bytes,
        mimeType: input.source.mimeType,
        // The media keeps its own frame. Cropping to a platform's shape is a
        // separate decision, and doing it silently here would surprise someone
        // who only asked for a soundtrack.
        fit: 'cover',
      },
    ],
    segments: [
      {
        clipIndex: 0,
        startFrame: 0,
        endFrame: totalFrames,
        overlays: [],
        // No Ken Burns: the caller asked for music, not motion.
        motion: null,
      },
    ],
    audio: {
      bytes: input.audio.bytes,
      mimeType: input.audio.mimeType,
      startSeconds: input.audio.startSeconds ?? 0,
      fadeInSeconds: fade,
      fadeOutSeconds: fade,
    },
    deterministic: false,
  };
}
