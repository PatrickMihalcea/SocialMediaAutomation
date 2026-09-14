import 'server-only';
import { MediaStatus, MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { PermanentJobError } from '@/lib/queue/runner';
import type { NodeRunContext } from '@/lib/workflows/node-context';

interface Config {
  mode: 'random' | 'specific';
  folderId: string | null;
  mediaAssetId: string | null;
  requireBeatGrid: boolean;
}

/**
 * Picks the track the slideshow will cut to.
 *
 * Random selection is seeded on the run id rather than Math.random, so re-running
 * a workflow to inspect a failure reproduces the same track — a run you cannot
 * reproduce is a run you cannot debug.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;

  if (config.mode === 'specific') {
    if (!config.mediaAssetId) {
      throw new PermanentJobError('This step is set to a specific track but none is chosen.');
    }
    const asset = await db.mediaAsset.findFirst({
      where: {
        id: config.mediaAssetId,
        workspaceId: ctx.workspaceId,
        type: MediaType.AUDIO,
      },
      select: { id: true, filename: true, bpm: true, beatGrid: true, analysedAt: true, beatAnalyzer: true },
    });
    if (!asset) throw new PermanentJobError('That track is no longer in the media library.');
    assertGrid(asset, config.requireBeatGrid);
    return { audio: asset.id, bpm: asset.bpm };
  }

  const candidates = await db.mediaAsset.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      type: MediaType.AUDIO,
      status: MediaStatus.READY,
      ...(config.folderId ? { folderId: config.folderId } : {}),
      ...(config.requireBeatGrid ? { analysedAt: { not: null } } : {}),
    },
    select: { id: true, filename: true, bpm: true, beatGrid: true, analysedAt: true, beatAnalyzer: true },
    orderBy: { createdAt: 'asc' },
  });

  if (candidates.length === 0) {
    throw new PermanentJobError(
      config.requireBeatGrid
        ? 'No analysed tracks are available. Upload music, or turn off "require a beat grid".'
        : 'No music is available in this workspace. Upload a track first.',
    );
  }

  const chosen = candidates[seededIndex(ctx.runId, candidates.length)];
  assertGrid(chosen, config.requireBeatGrid);
  return { audio: chosen.id, bpm: chosen.bpm };
}

function assertGrid(
  asset: { filename: string; beatGrid: number[]; analysedAt: Date | null; beatAnalyzer: string | null },
  required: boolean,
): void {
  if (!required) return;
  if (!asset.analysedAt || asset.beatGrid.length < 4) {
    throw new PermanentJobError(
      `"${asset.filename}" has no beat grid yet. Wait for analysis to finish, or set a BPM on the slideshow step.`,
    );
  }
  // An even grid guessed from a tempo is not a detected one. A workflow that
  // asked for a real beat grid gets told, rather than quietly cutting to a
  // metronome that drifts against the record.
  if (asset.beatAnalyzer === 'constant-bpm') {
    throw new PermanentJobError(
      `"${asset.filename}" only has an estimated beat grid, not a detected one. Install the audio analyser, or turn off "require beat grid".`,
    );
  }
}

/** Deterministic per run: the same run id always picks the same track. */
function seededIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % length;
}
