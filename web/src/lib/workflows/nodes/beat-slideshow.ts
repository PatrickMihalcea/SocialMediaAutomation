import 'server-only';
import { MediaStatus, MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { mediaKey, storage } from '@/lib/storage';
import { enqueue } from '@/lib/queue';
import { PermanentJobError } from '@/lib/queue/runner';
import { resolveBeatGrid } from '@/lib/audio/analyse';
import { buildBeatPlan } from '@/lib/render/plan';
import { prepareImage } from '@/lib/render/layout';
import { renderer } from '@/lib/render';
import type { BeatSegment, RenderPlan } from '@/lib/render/types';
import type { NodeRunContext } from '@/lib/workflows/node-context';
import { resolveVideoOutputDimensions } from '@/lib/workflows/video-output-presets';

interface Config {
  beatsPerClip: number;
  size?: string;
  width?: number;
  height?: number;
  fps: number;
  fit: 'cover' | 'blur-pad';
  kenBurns: boolean;
  visualLeadMs: number;
  fadeOutSeconds: number;
}

const SUPERSAMPLE = 2;

/**
 * Cuts images and source video clips to the beat and renders one video.
 *
 * The interesting decisions all happen in buildBeatPlan, which is pure — this
 * node is the part that talks to the database, the object store and the encoder.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const { width, height } = resolveVideoOutputDimensions(config);
  const mediaIds = asIds(ctx.inputs.images);
  const audioId = typeof ctx.inputs.audio === 'string' ? ctx.inputs.audio : null;
  const titles = asStrings(ctx.inputs.titles);

  if (mediaIds.length === 0) throw new PermanentJobError('No images or videos reached this step.');
  if (!audioId) throw new PermanentJobError('No track reached this step.');

  const engine = renderer();
  if (!(await engine.isAvailable())) {
    throw new PermanentJobError(
      'Video rendering is not set up on this deployment. Install ffmpeg and set RENDER_DRIVER=ffmpeg.',
    );
  }

  // Tenancy check: media ids arrive as plain JSON from an upstream step, so they
  // are re-fetched scoped to this workspace rather than trusted.
  const mediaAssets = await db.mediaAsset.findMany({
    where: {
      id: { in: mediaIds },
      workspaceId: ctx.workspaceId,
      type: { in: [MediaType.IMAGE, MediaType.VIDEO] },
    },
  });
  const ordered = resolveOrderedAssets(mediaIds, mediaAssets);

  const audio = await db.mediaAsset.findFirst({
    where: { id: audioId, workspaceId: ctx.workspaceId, type: MediaType.AUDIO },
  });
  if (!audio) throw new PermanentJobError('That track is no longer in the media library.');

  const grid = await resolveBeatGrid(audio);
  const plan = buildBeatPlan({
    grid,
    imageCount: ordered.length,
    beatsPerClip: config.beatsPerClip,
    fps: config.fps,
    visualLeadMs: config.visualLeadMs,
  });

  await ctx.assertNotCancelled();
  await ctx.heartbeat();

  const used = ordered.slice(0, plan.imageCount);
  const clips: RenderPlan['clips'] = [];
  for (const asset of used) {
    const bytes = await storage().get(asset.storageKey);
    if (asset.type === MediaType.IMAGE) {
      const prepared = await prepareImage(bytes, {
        width,
        height,
        supersample: SUPERSAMPLE,
        fit: config.fit,
      });
      clips.push({ kind: 'image', ...prepared, fit: config.fit });
    } else {
      clips.push({ kind: 'video', bytes, mimeType: asset.mimeType, fit: config.fit });
    }
    await ctx.heartbeat();
  }

  const renderPlan: RenderPlan = {
    width,
    height,
    fps: config.fps,
    totalFrames: plan.totalFrames,
    supersample: SUPERSAMPLE,
    clips,
    deterministic: false,
    segments: plan.cutFrames.slice(0, -1).map((startFrame, index) => ({
      clipIndex: index,
      startFrame,
      endFrame: plan.cutFrames[index + 1],
      // Alternating direction stops a long run of clips feeling mechanical.
      motion: config.kenBurns
        ? index % 2 === 0
          ? { fromZoom: 1, toZoom: 1.1 }
          : { fromZoom: 1.1, toZoom: 1 }
        : null,
      overlays: [],
    })),
    audio: {
      bytes: await storage().get(audio.storageKey),
      mimeType: audio.mimeType,
      startSeconds: plan.audioStartSeconds,
      fadeInSeconds: 0.04,
      fadeOutSeconds: config.fadeOutSeconds,
    },
  };

  await ctx.assertNotCancelled();
  const result = await engine.render(renderPlan);

  const filename = outputName(ctx.workflowName, 'cut', ctx.runId, result.extension);
  const key = mediaKey(ctx.workspaceId, filename, 'derived');
  await storage().put(key, result.data, result.mimeType);

  /**
   * Where each clip begins and ends in the finished video, and what it was
   * titled.
   *
   * Stored on the asset rather than handed downstream on a port of its own:
   * these belong to this particular video, and a later step that is given the
   * video needs them to label its cuts. Passing them separately meant two
   * connections that had to be kept pointing at the same step, and nothing
   * stopped them diverging.
   */
  const cutPoints: BeatSegment[] = plan.cutFrames.slice(0, -1).map((startFrame, index) => ({
    index,
    mediaAssetId: used[index].id,
    mediaKind: used[index].type as 'IMAGE' | 'VIDEO',
    ...(used[index].type === MediaType.IMAGE ? { imageAssetId: used[index].id } : {}),
    startFrame,
    endFrame: plan.cutFrames[index + 1],
    startSeconds: startFrame / config.fps,
    endSeconds: plan.cutFrames[index + 1] / config.fps,
    title: titles[index] ?? null,
  }));

  const asset = await db.mediaAsset.create({
    data: {
      workspaceId: ctx.workspaceId,
      uploadedById: ctx.userId,
      filename,
      mimeType: result.mimeType,
      type: MediaType.VIDEO,
      size: result.data.byteLength,
      width: result.width,
      height: result.height,
      duration: result.durationSeconds,
      storageKey: key,
      // READY, not PROCESSING. The encoder is authoritative about dimensions
      // and duration, so there is nothing to wait for — and the composer only
      // resolves media that is READY, so leaving it PROCESSING would make a
      // downstream draft step fail until the prober happened to catch up.
      // process-media still runs, to add the poster frame.
      status: MediaStatus.READY,
      derivedFromId: audio.id,
      derivationPreset: JSON.stringify({
        kind: 'beat-video',
        renderer: result.renderer,
        bpm: grid.bpm,
        beatsPerClip: plan.beatsPerClip,
        startBeatIndex: plan.startBeatIndex,
        adjustment: plan.adjustment,
        beatAnalyzer: grid.analyzer,
        mediaAssetIds: used.map((item) => item.id),
        imageAssetIds: used.filter((item) => item.type === MediaType.IMAGE).map((item) => item.id),
        cutPoints,
      }),
    },
    select: { id: true },
  });

  await ctx.emitAssets('video', [asset.id]);
  await enqueue(
    'process-media',
    { mediaAssetId: asset.id },
    { workspaceId: ctx.workspaceId, dedupeKey: `process-media:${asset.id}` },
  );

  return {
    video: asset.id,
    // Surfaced so the run view can explain a video that came out shorter.
    adjustment: plan.adjustment,
  };
}

const asIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Matches every requested id against what the database actually returned, and
 * rebuilds the list in the caller's original order (including repeats).
 *
 * Checked by distinct id, not by comparing the two lists' lengths: a merge
 * step upstream (Combine media, say) can legitimately repeat the same image —
 * bookending a slideshow with its opening shot is a real edit choice, not a
 * mistake. `findMany` only ever returns one row per distinct id, so a length
 * comparison against a list that repeats an id fails every time regardless of
 * whether anything is actually missing — this is the fix for exactly that.
 */
export function resolveOrderedAssets<T extends { id: string }>(mediaIds: string[], found: T[]): T[] {
  const byId = new Map(found.map((asset) => [asset.id, asset]));
  if (mediaIds.some((id) => !byId.has(id))) {
    throw new PermanentJobError('Some images or videos are no longer in the media library.');
  }
  return mediaIds.map((id) => byId.get(id)!);
}
const asStrings = asIds;

/**
 * A filename someone will recognise in the media library.
 *
 * Output used to be named with an epoch timestamp, which the library's
 * humaniser strips back to a single adjective — a draft would show "Labelled"
 * rather than anything resembling the video. The workflow name plus a short run
 * id keeps it readable and still unique.
 */
function outputName(workflowName: string, suffix: string, runId: string, extension: string): string {
  const stem =
    workflowName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'workflow';
  return `${stem}-${suffix}-${runId.slice(0, 6)}.${extension}`;
}
