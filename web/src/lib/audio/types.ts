/**
 * Beat analysis.
 *
 * A grid is cached on the asset rather than recomputed per render, and the
 * reason is stronger than saving CPU: analysis is not reproducible across
 * machines. mp3 decoders disagree about the encoder-delay samples by up to
 * ~26ms, and multi-threaded BLAS reductions in numpy are not bit-stable. The
 * cached grid is therefore the only thing that makes a re-render cut in the
 * same places as the original.
 */
export interface BeatGrid {
  /** Beat onsets in seconds from the start of the source file, ascending. */
  beats: number[];
  /** The subset of `beats` that starts a bar. Empty when bar one is unknown. */
  downbeats: number[];
  /** Per-beat onset strength 0..1, parallel to `beats`. Empty for synthetic grids. */
  beatStrength: number[];
  bpm: number;
  beatsPerBar: number;
  durationSeconds: number;
  /** 0 for a synthesised grid, so a caller can refuse to auto-publish one. */
  confidence: number;
  /** `librosa@0.10.2.post1` or `constant-bpm`. Scopes cache invalidation. */
  analyzer: string;
  /** Bumped when the analysis contract changes, independent of the library. */
  version: number;
}

export interface AudioAnalyzer {
  readonly name: 'librosa' | 'constant-bpm';
  /** False when the interpreter or the script is missing. Cached, like hasFfmpeg(). */
  isAvailable(): Promise<boolean>;
  analyze(input: {
    audio: Buffer;
    filename: string;
    /** Pins the tempo search, the cheapest fix for half/double-tempo errors. */
    hintBpm?: number;
    /** Only the fallback needs this; librosa reads it from the file. */
    durationSeconds?: number;
  }): Promise<BeatGrid>;
}

export class AudioAnalysisError extends Error {
  /** Matches AiError's shape, which isPermanent() in the job runner understands. */
  readonly retryable: boolean;
  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AudioAnalysisError';
    this.retryable = options.retryable ?? false;
  }
}

/** Beyond this the tail is extrapolated from bpm; a social clip uses the head. */
export const MAX_CACHED_BEATS = 4096;
