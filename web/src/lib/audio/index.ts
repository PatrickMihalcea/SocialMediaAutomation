import 'server-only';
import { env } from '@/lib/env';
import { ConstantBpmAnalyzer } from '@/lib/audio/constant';
import { LibrosaAnalyzer } from '@/lib/audio/librosa';
import type { AudioAnalyzer } from '@/lib/audio/types';

let cached: AudioAnalyzer | null = null;

/** Matches storage() and aiProvider(): env picks the driver, cached per process. */
export function audioAnalyzer(): AudioAnalyzer {
  if (!cached) {
    cached = env.AUDIO_ANALYZER === 'librosa' ? new LibrosaAnalyzer() : new ConstantBpmAnalyzer();
  }
  return cached;
}

/** The fallback, for callers that need a grid even when the real one is absent. */
export const constantAnalyzer = new ConstantBpmAnalyzer();

export type { AudioAnalyzer, BeatGrid } from '@/lib/audio/types';
