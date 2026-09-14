import 'server-only';
import { MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { PermanentJobError } from '@/lib/queue/runner';
import { audioAnalyzer, constantAnalyzer } from '@/lib/audio';
import { MAX_CACHED_BEATS, type BeatGrid } from '@/lib/audio/types';

/**
 * Analyses one audio asset and caches its grid.
 *
 * Runs as its own job type as well as inline from processMediaAsset, so a
 * change to the analysis contract can re-analyse a whole library without also
 * re-running thumbnailing.
 */
export async function analyseAudioAsset(mediaAssetId: string): Promise<void> {
  const asset = await db.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!asset) throw new PermanentJobError(`Audio asset ${mediaAssetId} no longer exists`);
  if (asset.type !== MediaType.AUDIO) return;

  const analyzer = audioAnalyzer();
  if (!(await analyzer.isAvailable())) {
    console.warn(`[audio] ${analyzer.name} unavailable; leaving ${asset.filename} unanalysed`);
    return;
  }

  const bytes = await storage().get(asset.storageKey);
  const grid = await analyzer.analyze({
    audio: bytes,
    filename: asset.filename,
    hintBpm: asset.bpm ?? undefined,
    durationSeconds: asset.duration ?? undefined,
  });

  await db.mediaAsset.update({
    where: { id: asset.id },
    data: {
      bpm: grid.bpm,
      beatGrid: grid.beats.slice(0, MAX_CACHED_BEATS),
      downbeats: grid.downbeats,
      beatStrength: grid.beatStrength,
      beatsPerBar: grid.beatsPerBar,
      beatAnalyzer: grid.analyzer,
      beatGridVersion: grid.version,
      analysedAt: new Date(),
      // The browser's reported duration is replaced by the decoder's, which is
      // the one the beat times are measured against.
      duration: grid.durationSeconds || asset.duration,
    },
  });
}

/**
 * The grid a render should cut to, resolved from the cache with an explicit
 * fallback. The renderer is never handed a cache lookup — it takes a resolved
 * grid as a parameter, so a cache hit and a miss cannot change its behaviour.
 */
export async function resolveBeatGrid(
  asset: {
    id: string;
    filename: string;
    bpm: number | null;
    beatGrid: number[];
    downbeats: number[];
    beatStrength: number[];
    beatsPerBar: number | null;
    beatAnalyzer: string | null;
    beatGridVersion: number | null;
    analysedAt: Date | null;
    duration: number | null;
  },
  fallbackBpm?: number,
): Promise<BeatGrid> {
  if (asset.analysedAt && asset.beatGrid.length >= 4) {
    // A grid the fallback synthesised is stored like any other, but it must not
    // read back as a detected one: it is an even tempo guess, not a measurement,
    // and a caller that refuses to publish on a guess relies on this being
    // honest about it.
    const synthesised = asset.beatAnalyzer === 'constant-bpm';
    return {
      beats: asset.beatGrid,
      downbeats: asset.downbeats,
      beatStrength: asset.beatStrength,
      bpm: asset.bpm ?? 120,
      beatsPerBar: asset.beatsPerBar ?? 4,
      durationSeconds: asset.duration ?? asset.beatGrid[asset.beatGrid.length - 1],
      confidence: synthesised ? 0 : asset.downbeats.length > 0 ? 1 : 0,
      analyzer: asset.beatAnalyzer ?? 'cached',
      version: asset.beatGridVersion ?? 1,
    };
  }

  const bpm = fallbackBpm ?? asset.bpm ?? undefined;
  if (!bpm) {
    throw new PermanentJobError(
      `"${asset.filename}" has no beat grid and no BPM to fall back on. Set a BPM on the slideshow step, or install the audio analyser.`,
    );
  }
  return constantAnalyzer.analyze({
    filename: asset.filename,
    hintBpm: bpm,
    durationSeconds: asset.duration ?? undefined,
  });
}
