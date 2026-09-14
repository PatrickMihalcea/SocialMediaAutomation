import 'server-only';
import { MediaStatus, MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { mediaKey, storage } from '@/lib/storage';
import { enqueue } from '@/lib/queue';
import { PermanentJobError } from '@/lib/queue/runner';
import { hasFfmpeg } from '@/lib/media/process';
import { renderAudioTrim, renderVideoEdit } from '@/lib/media/ffmpeg-edit';
import { resolveBeatGrid } from '@/lib/audio/analyse';
import type { NodeRunContext } from '@/lib/workflows/node-context';

interface Config {
  mode: 'range' | 'bars';
  startSeconds: number | null;
  endSeconds: number | null;
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
  const mediaId = typeof ctx.inputs.audio === 'string' ? ctx.inputs.audio : null;
  if (!mediaId) throw new PermanentJobError('No audio or video reached this step.');
  if (!(await hasFfmpeg())) {
    throw new PermanentJobError('Trimming media needs ffmpeg, which is not installed here.');
  }

  const source = await db.mediaAsset.findFirst({
    where: {
      id: mediaId,
      workspaceId: ctx.workspaceId,
      type: { in: [MediaType.AUDIO, MediaType.VIDEO] },
    },
  });
  if (!source) throw new PermanentJobError('That audio or video is no longer in the media library.');

  let grid: Awaited<ReturnType<typeof resolveBeatGrid>> | null = null;
  let startSeconds = config.startSeconds ?? 0;
  let endSeconds = config.endSeconds ?? source.duration ?? 0;
  let startIndex = 0;
  let endIndex = 0;

  if (config.mode === 'bars') {
    if (source.type !== MediaType.AUDIO) {
      throw new PermanentJobError('Musical bars can only trim audio. Use Time range for video.');
    }
    grid = await resolveBeatGrid(source);
    const beatsPerBar = grid.beatsPerBar || 4;
    startIndex = chooseStart(grid, config);
    endIndex = Math.min(startIndex + config.bars * beatsPerBar, grid.beats.length - 1);
    startSeconds = grid.beats[startIndex];
    endSeconds = grid.beats[endIndex];
  }
  if (!(endSeconds > startSeconds)) {
    throw new PermanentJobError('The trim end must be after its start and inside the media duration.');
  }
  if (source.duration != null && endSeconds > source.duration + 0.01) {
    throw new PermanentJobError('The trim end is beyond the media duration.');
  }

  const sourceBytes = await storage().get(source.storageKey);
  const video = source.type === MediaType.VIDEO;
  const data = video
    ? await renderVideoEdit(sourceBytes, source.filename, { startSeconds, endSeconds })
    : await renderAudioTrim(sourceBytes, startSeconds, endSeconds);
  const extension = video ? 'mp4' : 'm4a';
  const mimeType = video ? 'video/mp4' : 'audio/mp4';
  const filename = `${source.filename.replace(/\.[^.]+$/, '')}-trimmed.${extension}`;
  const key = mediaKey(ctx.workspaceId, filename, 'derived');
  await storage().put(key, data, mimeType);

  const sourceBeats = grid?.beats ?? source.beatGrid;
  const beatPositions = sourceBeats
    .map((time, index) => ({ time, index }))
    .filter(({ time }) => time >= startSeconds && time <= endSeconds);
  const rebased = beatPositions.map(({ time }) => Number((time - startSeconds).toFixed(6)));
  const sourceDownbeats = grid?.downbeats ?? source.downbeats;

  const asset = await db.mediaAsset.create({
    data: {
      workspaceId: ctx.workspaceId,
      uploadedById: ctx.userId,
      filename,
      mimeType,
      type: source.type,
      size: data.byteLength,
      width: video ? source.width : null,
      height: video ? source.height : null,
      duration: endSeconds - startSeconds,
      storageKey: key,
      status: MediaStatus.READY,
      derivedFromId: source.id,
      derivationPreset: JSON.stringify({
        kind: 'media-trim',
        mode: config.mode,
        startSeconds,
        endSeconds,
        ...(config.mode === 'bars' ? { bars: config.bars } : {}),
      }),
      bpm: video ? null : (grid?.bpm ?? source.bpm),
      beatGrid: video ? [] : rebased,
      downbeats: video
        ? []
        : sourceDownbeats
            .filter((time) => time >= startSeconds && time <= endSeconds)
            .map((time) => Number((time - startSeconds).toFixed(6))),
      beatStrength: video
        ? []
        : beatPositions.map(({ index }) => (grid?.beatStrength ?? source.beatStrength)[index] ?? 0),
      beatsPerBar: video ? null : (grid?.beatsPerBar ?? source.beatsPerBar),
      beatAnalyzer: video ? null : (grid?.analyzer ?? source.beatAnalyzer),
      beatGridVersion: video ? null : (grid?.version ?? source.beatGridVersion),
      analysedAt: video ? null : new Date(),
    },
    select: { id: true },
  });

  await ctx.emitAssets('audio', [asset.id]);
  if (video) {
    await enqueue(
      'process-media',
      { mediaAssetId: asset.id },
      { workspaceId: ctx.workspaceId, dedupeKey: `process-media:${asset.id}` },
    );
  }
  return { audio: asset.id, startSeconds, endSeconds, mode: config.mode };
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
