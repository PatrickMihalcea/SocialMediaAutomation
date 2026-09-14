import type { AudioAnalyzer, BeatGrid } from '@/lib/audio/types';
import { MAX_CACHED_BEATS } from '@/lib/audio/types';

const DEFAULT_BPM = 120;

/**
 * Synthesises a perfectly even grid from a supplied tempo.
 *
 * Always available, so the renderer never has to handle "no analyzer at all".
 * It is honest about what it is — `confidence: 0` — which lets a workflow refuse
 * to publish unattended on a guessed grid. Even spacing drifts against a real
 * recording, but over a 20-second clip of a machine-quantised track it is close
 * enough to look deliberate.
 */
export class ConstantBpmAnalyzer implements AudioAnalyzer {
  readonly name = 'constant-bpm' as const;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  /** `audio` and `filename` are accepted to satisfy the interface and ignored. */
  async analyze(input: {
    audio?: Buffer;
    filename?: string;
    hintBpm?: number;
    durationSeconds?: number;
  }): Promise<BeatGrid> {
    const bpm = input.hintBpm && input.hintBpm > 0 ? input.hintBpm : DEFAULT_BPM;
    const duration = input.durationSeconds && input.durationSeconds > 0 ? input.durationSeconds : 180;
    const interval = 60 / bpm;

    const beats: number[] = [];
    for (let t = 0; t < duration && beats.length < MAX_CACHED_BEATS; t += interval) {
      beats.push(Number(t.toFixed(6)));
    }
    return {
      beats,
      downbeats: beats.filter((_, i) => i % 4 === 0),
      beatStrength: [],
      bpm,
      beatsPerBar: 4,
      durationSeconds: duration,
      confidence: 0,
      analyzer: this.name,
      version: 1,
    };
  }
}
