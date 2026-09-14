import type { BeatGrid } from '@/lib/audio/types';

/**
 * Beat arithmetic.
 *
 * Pure and native-dependency-free on purpose: this is where the feature's real
 * risk lives, so it is the part that must be testable without ffmpeg, Python or
 * a database.
 *
 * Two rules run through all of it:
 *  - Durations are quantised to integer frames immediately and never expressed
 *    in seconds again. Cuts then tile the timeline exactly, with no float drift
 *    and no overlay boundary landing a frame late.
 *  - Nothing here reads a cache. The grid arrives as a parameter, so a cache hit
 *    and a cache miss cannot produce different output shapes.
 */

export interface BeatPlanInput {
  grid: BeatGrid;
  imageCount: number;
  beatsPerClip: number;
  fps: number;
  /** Explicit start; when absent the plan finds the drop. */
  startSeconds?: number | null;
  /** Pushes the audio later so cuts read slightly ahead of the transient. */
  visualLeadMs?: number;
}

export interface BeatPlan {
  /** Index into grid.beats where the first clip begins. */
  startBeatIndex: number;
  /** Seconds into the source audio the render starts from. */
  audioStartSeconds: number;
  /** Frame boundaries, length imageCount + 1, strictly increasing from 0. */
  cutFrames: number[];
  /** Per-clip durations in frames, length imageCount. */
  durations: number[];
  totalFrames: number;
  totalSeconds: number;
  beatsPerClip: number;
  /** Which fallback fired, so the UI can explain a shortened video. */
  adjustment: 'none' | 'earlier-start' | 'halved-beats' | 'extrapolated' | 'dropped-images';
  imageCount: number;
}

export class BeatPlanError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = 'BeatPlanError';
  }
}

export function buildBeatPlan(input: BeatPlanInput): BeatPlan {
  const { grid, fps } = input;
  if (grid.beats.length < 2) {
    throw new BeatPlanError('That track has no usable beat grid to cut against.');
  }
  if (input.imageCount < 1) {
    throw new BeatPlanError('There are no images to build a video from.');
  }
  if (fps < 1) throw new BeatPlanError('Frame rate must be at least 1.');

  let beatsPerClip = Math.max(1, Math.floor(input.beatsPerClip));
  let imageCount = input.imageCount;
  let adjustment: BeatPlan['adjustment'] = 'none';

  let startBeatIndex = chooseStartBeat(grid, input.startSeconds ?? null);
  let beats = grid.beats;

  const needed = (count: number, per: number) => count * per;
  const available = () => beats.length - 1 - startBeatIndex;

  // Each fallback is tried in order and the first that fits wins. The order is
  // chosen so the video keeps its full image set for as long as possible.
  if (needed(imageCount, beatsPerClip) > available()) {
    const earlier = earliestDownbeat(grid, startBeatIndex);
    if (earlier < startBeatIndex && needed(imageCount, beatsPerClip) <= beats.length - 1 - earlier) {
      startBeatIndex = earlier;
      adjustment = 'earlier-start';
    }
  }

  // Extrapolation comes before halving. Trackers routinely stop following a
  // track through a breakdown or an outro while the music carries on, and
  // extending the grid at the detected tempo uses more of the same song without
  // touching the edit. Halving 8 beats to 4 changes how the video feels, so it
  // is the later, more invasive fallback.
  if (needed(imageCount, beatsPerClip) > available() && grid.bpm > 0 && isEvenlySpaced(beats, grid.bpm)) {
    const interval = 60 / grid.bpm;
    const extended = [...beats];
    let next = extended[extended.length - 1] + interval;
    while (
      extended.length - 1 - startBeatIndex < needed(imageCount, beatsPerClip) &&
      next < grid.durationSeconds
    ) {
      extended.push(Number(next.toFixed(6)));
      next += interval;
    }
    if (extended.length > beats.length) {
      beats = extended;
      adjustment = 'extrapolated';
    }
  }

  // Halving keeps everything bar-aligned; dividing by three would not.
  while (needed(imageCount, beatsPerClip) > available() && beatsPerClip > 1) {
    beatsPerClip = Math.max(1, Math.floor(beatsPerClip / 2));
    adjustment = 'halved-beats';
  }

  if (needed(imageCount, beatsPerClip) > available()) {
    imageCount = Math.max(1, Math.floor(available() / beatsPerClip));
    adjustment = 'dropped-images';
  }

  const audioStartSeconds = beats[startBeatIndex] + (input.visualLeadMs ?? 0) / 1000;
  const origin = beats[startBeatIndex];

  const cutFrames: number[] = [];
  for (let i = 0; i <= imageCount; i++) {
    const beatIndex = startBeatIndex + i * beatsPerClip;
    const time = beats[Math.min(beatIndex, beats.length - 1)];
    cutFrames.push(Math.round((time - origin) * fps));
  }

  // A clip shorter than a frame cannot be rendered; nudge it and everything
  // after it so the timeline stays strictly increasing.
  for (let i = 1; i < cutFrames.length; i++) {
    if (cutFrames[i] <= cutFrames[i - 1]) cutFrames[i] = cutFrames[i - 1] + 1;
  }

  const durations = cutFrames.slice(1).map((frame, i) => frame - cutFrames[i]);
  const totalFrames = cutFrames[cutFrames.length - 1];

  // The invariant the overlay ranges depend on: segments tile exactly.
  const summed = durations.reduce((a, b) => a + b, 0);
  if (summed !== totalFrames) {
    throw new BeatPlanError('Bridge88 could not lay the clips onto a clean timeline.');
  }

  return {
    startBeatIndex,
    audioStartSeconds,
    cutFrames,
    durations,
    totalFrames,
    totalSeconds: totalFrames / fps,
    beatsPerClip,
    adjustment,
    imageCount,
  };
}

/**
 * Where to start cutting.
 *
 * An explicit start snaps to the nearest downbeat. Otherwise the plan looks for
 * the drop: the first downbeat whose bar carries at least 60% of the track's
 * peak kick energy. Without this, a track that opens on twenty seconds of pad
 * produces twenty seconds of video with nothing happening.
 */
function chooseStartBeat(grid: BeatGrid, startSeconds: number | null): number {
  const downbeatIndices = downbeatPositions(grid);
  if (downbeatIndices.length === 0) return 0;

  if (startSeconds != null) {
    let best = downbeatIndices[0];
    let bestDelta = Infinity;
    for (const index of downbeatIndices) {
      const delta = Math.abs(grid.beats[index] - startSeconds);
      // Ties prefer the later beat, so an explicit start is never overshot back.
      if (delta < bestDelta || (delta === bestDelta && grid.beats[index] >= startSeconds)) {
        best = index;
        bestDelta = delta;
      }
    }
    return best;
  }

  if (grid.beatStrength.length !== grid.beats.length || grid.beatStrength.length === 0) {
    return downbeatIndices[0];
  }
  const peak = Math.max(...grid.beatStrength);
  if (peak <= 0) return downbeatIndices[0];

  const bar = grid.beatsPerBar || 4;
  for (const index of downbeatIndices) {
    const window = grid.beatStrength.slice(index, index + bar);
    if (window.length === 0) continue;
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    if (mean >= 0.6 * peak) return index;
  }
  return downbeatIndices[0];
}

/** Positions in `beats` that are downbeats. Falls back to a 4/4 assumption. */
function downbeatPositions(grid: BeatGrid): number[] {
  if (grid.downbeats.length === 0) {
    const bar = grid.beatsPerBar || 4;
    return grid.beats.map((_, i) => i).filter((i) => i % bar === 0);
  }
  const lookup = new Set(grid.downbeats.map((t) => t.toFixed(6)));
  return grid.beats.map((t, i) => (lookup.has(t.toFixed(6)) ? i : -1)).filter((i) => i >= 0);
}

function earliestDownbeat(grid: BeatGrid, before: number): number {
  const positions = downbeatPositions(grid).filter((i) => i < before);
  return positions.length ? positions[0] : before;
}

/**
 * Whether the tail of the grid is close enough to the detected tempo to extend.
 *
 * Extrapolating a rubato or live-played track would drift audibly within a few
 * bars, so this only agrees for a machine-quantised one — which is almost
 * everything in this genre, and exactly what the check is for.
 */
function isEvenlySpaced(beats: number[], bpm: number): boolean {
  if (beats.length < 8) return false;
  const expected = 60 / bpm;
  const tail = beats.slice(-8);
  return tail.slice(1).every((t, i) => Math.abs(t - tail[i] - expected) < expected * 0.12);
}
