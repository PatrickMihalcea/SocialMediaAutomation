import 'server-only';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { MediaStatus, MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { mediaKey, storage } from '@/lib/storage';
import { PermanentJobError } from '@/lib/queue/runner';
import { hasFfmpeg } from '@/lib/media/process';
import { resolveBeatGrid } from '@/lib/audio/analyse';
import type { NodeRunContext } from '@/lib/workflows/node-context';

const run_ = promisify(execFile);

interface Config {
  startSeconds: number | null;
  bars: number;
  snapToDownbeat: boolean;
}

/**
 * Cuts a track to a whole number of bars, snapped to a downbeat.
 *
 * The trimmed copy carries its own beat grid, rebased to the new zero, so a
 * downstream slideshow cuts correctly without knowing it is working on an
 * excerpt. Rebasing here is what keeps the grid honest: the cached grid on the
 * original is always in source-file time and is never rewritten.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const audioId = typeof ctx.inputs.audio === 'string' ? ctx.inputs.audio : null;
  if (!audioId) throw new PermanentJobError('No track reached this step.');
  if (!(await hasFfmpeg())) {
    throw new PermanentJobError('Trimming audio needs ffmpeg, which is not installed here.');
  }

  const source = await db.mediaAsset.findFirst({
    where: { id: audioId, workspaceId: ctx.workspaceId, type: MediaType.AUDIO },
  });
  if (!source) throw new PermanentJobError('That track is no longer in the media library.');

  const grid = await resolveBeatGrid(source);
  const beatsPerBar = grid.beatsPerBar || 4;
  const wanted = config.bars * beatsPerBar;

  const startIndex = chooseStart(grid, config);
  const endIndex = Math.min(startIndex + wanted, grid.beats.length - 1);
  const startSeconds = grid.beats[startIndex];
  const endSeconds = grid.beats[endIndex];
  if (!(endSeconds > startSeconds)) {
    throw new PermanentJobError('That track is too short for the number of bars requested.');
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'b88-trim-'));
  try {
    const input = path.join(dir, 'in.bin');
    const output = path.join(dir, 'out.m4a');
    await writeFile(input, await storage().get(source.storageKey));

    await run_(
      'ffmpeg',
      [
        '-hide_banner', '-nostdin', '-v', 'error', '-y',
        '-i', input,
        // Filter-level trimming rather than an input -ss: seeking an mp3 before
        // the decoder depends on how the build handles encoder-delay side data.
        '-af', `atrim=start=${startSeconds.toFixed(6)}:end=${endSeconds.toFixed(6)},asetpts=PTS-STARTPTS`,
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        '-fflags', '+bitexact', '-flags', '+bitexact', '-map_metadata', '-1',
        output,
      ],
      { timeout: env.RENDER_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 },
    );

    const data = await readFile(output);
    const filename = `${source.filename.replace(/\.[^.]+$/, '')}-${config.bars}bars.m4a`;
    const key = mediaKey(ctx.workspaceId, filename, 'derived');
    await storage().put(key, data, 'audio/mp4');

    const rebased = grid.beats
      .slice(startIndex, endIndex + 1)
      .map((t) => Number((t - startSeconds).toFixed(6)));
    const rebasedDownbeats = rebased.filter((_, i) => i % beatsPerBar === 0);

    const asset = await db.mediaAsset.create({
      data: {
        workspaceId: ctx.workspaceId,
        uploadedById: ctx.userId,
        filename,
        mimeType: 'audio/mp4',
        type: MediaType.AUDIO,
        size: data.byteLength,
        duration: endSeconds - startSeconds,
        storageKey: key,
        status: MediaStatus.READY,
        derivedFromId: source.id,
        derivationPreset: JSON.stringify({ kind: 'audio-trim', startSeconds, bars: config.bars }),
        bpm: grid.bpm,
        beatGrid: rebased,
        downbeats: rebasedDownbeats,
        beatStrength: grid.beatStrength.slice(startIndex, endIndex + 1),
        beatsPerBar,
        beatAnalyzer: grid.analyzer,
        beatGridVersion: grid.version,
        analysedAt: new Date(),
      },
      select: { id: true },
    });

    await ctx.emitAssets('audio', [asset.id]);
    return { audio: asset.id, startSeconds, bars: config.bars };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function chooseStart(
  grid: Awaited<ReturnType<typeof resolveBeatGrid>>,
  config: Config,
): number {
  const beatsPerBar = grid.beatsPerBar || 4;
  const downbeatIndices = grid.downbeats.length
    ? grid.beats.map((t, i) => (grid.downbeats.includes(t) ? i : -1)).filter((i) => i >= 0)
    : grid.beats.map((_, i) => i).filter((i) => i % beatsPerBar === 0);

  if (config.startSeconds == null) {
    // No explicit start: begin at the first downbeat that is not in the intro.
    return downbeatIndices[0] ?? 0;
  }
  if (!config.snapToDownbeat) {
    const nearest = grid.beats.findIndex((t) => t >= config.startSeconds!);
    return nearest >= 0 ? nearest : 0;
  }
  let best = downbeatIndices[0] ?? 0;
  let bestDelta = Infinity;
  for (const index of downbeatIndices) {
    const delta = Math.abs(grid.beats[index] - config.startSeconds);
    if (delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
  }
  return best;
}
