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

interface Config {
  beatsPerClip: number;
  width: number;
  height: number;
  fps: number;
  fit: 'cover' | 'blur-pad';
  kenBurns: boolean;
  visualLeadMs: number;
  fadeOutSeconds: number;
}

const SUPERSAMPLE = 2;

/**
 * Cuts the images to the beat and renders one video.
 *
 * The interesting decisions all happen in buildBeatPlan, which is pure — this
 * node is the part that talks to the database, the object store and the encoder.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const imageIds = asIds(ctx.inputs.images);
  const audioId = typeof ctx.inputs.audio === 'string' ? ctx.inputs.audio : null;
  const titles = asStrings(ctx.inputs.titles);

  if (imageIds.length === 0) throw new PermanentJobError('No images reached this step.');
  if (!audioId) throw new PermanentJobError('No track reached this step.');

  const engine = renderer();
  if (!(await engine.isAvailable())) {
    throw new PermanentJobError(
      'Video rendering is not set up on this deployment. Install ffmpeg and set RENDER_DRIVER=ffmpeg.',
    );
  }

  // Tenancy check: media ids arrive as plain JSON from an upstream step, so they
  // are re-fetched scoped to this workspace rather than trusted.
  const images = await db.mediaAsset.findMany({
    where: { id: { in: imageIds }, workspaceId: ctx.workspaceId, type: MediaType.IMAGE },
  });
  if (images.length !== imageIds.length) {
    throw new PermanentJobError('Some images are no longer in the media library.');
  }
  const ordered = imageIds.map((id) => images.find((image) => image.id === id)!);

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
  const prepared = [];
  for (const image of used) {
    const bytes = await storage().get(image.storageKey);
    prepared.push(
      await prepareImage(bytes, {
        width: config.width,
        height: config.height,
        supersample: SUPERSAMPLE,
        fit: config.fit,
      }),
    );
    await ctx.heartbeat();
  }

  const renderPlan: RenderPlan = {
    width: config.width,
    height: config.height,
    fps: config.fps,
    totalFrames: plan.totalFrames,
    supersample: SUPERSAMPLE,
    images: prepared,
    deterministic: false,
    segments: plan.cutFrames.slice(0, -1).map((startFrame, index) => ({
      imageIndex: index,
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

  const filename = `beat-video-${Date.now()}.${result.extension}`;
  const key = mediaKey(ctx.workspaceId, filename, 'derived');
  await storage().put(key, result.data, result.mimeType);

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
        imageAssetIds: used.map((i) => i.id),
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

  const segments: BeatSegment[] = plan.cutFrames.slice(0, -1).map((startFrame, index) => ({
    index,
    imageAssetId: used[index].id,
    startFrame,
    endFrame: plan.cutFrames[index + 1],
    startSeconds: startFrame / config.fps,
    endSeconds: plan.cutFrames[index + 1] / config.fps,
    title: titles[index] ?? null,
  }));

  return {
    video: asset.id,
    segments,
    // Surfaced so the run view can explain a video that came out shorter.
    adjustment: plan.adjustment,
  };
}

const asIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const asStrings = asIds;
