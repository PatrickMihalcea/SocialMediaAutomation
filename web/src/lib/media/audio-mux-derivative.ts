import 'server-only';
import { MediaStatus, MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { PermanentJobError } from '@/lib/queue/runner';
import { mediaKey, storage } from '@/lib/storage';
import { renderer } from '@/lib/render';
import { buildAudioMuxPlan, type MuxSource } from '@/lib/media/audio-mux';
import { enqueue } from '@/lib/queue';

/**
 * Claims the asset the render will fill in, and queues the render.
 *
 * The row exists before the pixels do because the caller needs something to
 * point at now: the composer swaps its attachment to this id immediately, and
 * the library shows it processing, exactly as an upload does. ffmpeg only
 * exists on the worker, so the render cannot happen in the request that asked
 * for it.
 *
 * Always a derivative, never an edit in place. The original stays untouched, so
 * changing your mind about the music costs nothing and a post that already went
 * out silent keeps pointing at what was actually published.
 */
export async function queueAudioMux(input: {
  sourceAssetId: string;
  audioAssetId: string;
  /** Stills only; a video keeps its own length. */
  seconds?: number | null;
  startSeconds?: number;
  userId?: string;
}): Promise<{ id: string }> {
  const [source, audio] = await Promise.all([
    db.mediaAsset.findUniqueOrThrow({ where: { id: input.sourceAssetId } }),
    db.mediaAsset.findUniqueOrThrow({ where: { id: input.audioAssetId } }),
  ]);
  if (source.workspaceId !== audio.workspaceId) {
    throw new PermanentJobError('The track and the media belong to different workspaces.');
  }
  if (audio.type !== MediaType.AUDIO) throw new PermanentJobError('Pick an audio file as the track.');
  if (source.type !== MediaType.IMAGE && source.type !== MediaType.VIDEO) {
    throw new PermanentJobError('Only an image or a video can carry a soundtrack.');
  }
  const created = await db.mediaAsset.create({
    data: {
      workspaceId: source.workspaceId,
      folderId: source.folderId,
      uploadedById: input.userId ?? source.uploadedById,
      filename: withSoundtrackName(source.filename),
      mimeType: 'video/mp4',
      // An image with a soundtrack is a video. No platform has a post type
      // that is a photograph with sound.
      type: MediaType.VIDEO,
      size: 0,
      width: source.width,
      height: source.height,
      // Nothing is written here yet. The render fills it, and PROCESSING is
      // what stops anything publishing an empty object in the meantime.
      storageKey: mediaKey(source.workspaceId, withSoundtrackName(source.filename), 'derived'),
      altText: source.altText,
      status: MediaStatus.PROCESSING,
      derivedFromId: source.id,
      derivationPreset: JSON.stringify({
        kind: 'audio-mux',
        audioAssetId: audio.id,
        audioName: audio.filename,
        seconds: input.seconds ?? null,
        startSeconds: input.startSeconds ?? 0,
      }),
    },
    select: { id: true },
  });

  await enqueue('mux-audio', { mediaAssetId: created.id }, { workspaceId: source.workspaceId });
  return created;
}

/** The render itself, on a machine that has ffmpeg. */
export async function runAudioMux(mediaAssetId: string): Promise<void> {
  const asset = await db.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!asset) throw new PermanentJobError(`Media asset ${mediaAssetId} no longer exists`);
  if (asset.status === MediaStatus.READY) return;

  const settings = readMuxSettings(asset.derivationPreset);
  if (!settings || !asset.derivedFromId) {
    throw new PermanentJobError('This asset is not a soundtrack derivative.');
  }
  if (!(await renderer().isAvailable())) {
    // Refused, never copied through: a "derivative" that is silently the
    // original would be published as though the music were on it.
    throw new PermanentJobError('Adding music needs ffmpeg, which is not available on this machine.');
  }

  const [source, audio] = await Promise.all([
    db.mediaAsset.findUniqueOrThrow({ where: { id: asset.derivedFromId } }),
    db.mediaAsset.findUniqueOrThrow({ where: { id: settings.audioAssetId } }),
  ]);
  const [sourceBytes, audioBytes] = await Promise.all([
    storage().get(source.storageKey),
    storage().get(audio.storageKey),
  ]);

  const media: MuxSource = {
    kind: source.type === MediaType.VIDEO ? 'video' : 'image',
    bytes: sourceBytes,
    mimeType: source.mimeType,
    // A still that never finished processing has no measured size; 1080x1920
    // is the shape this product mostly makes.
    width: source.width ?? 1080,
    height: source.height ?? 1920,
    durationSeconds: source.duration,
  };

  const result = await renderer().render(
    buildAudioMuxPlan({
      source: media,
      audio: {
        bytes: audioBytes,
        mimeType: audio.mimeType,
        durationSeconds: audio.duration,
        startSeconds: settings.startSeconds,
      },
      requestedSeconds: settings.seconds,
    }),
  );

  await storage().put(asset.storageKey, result.data, result.mimeType);
  await db.mediaAsset.update({
    where: { id: asset.id },
    data: {
      size: result.data.byteLength,
      width: result.width,
      height: result.height,
      duration: result.durationSeconds,
      status: MediaStatus.PROCESSING,
    },
  });
  // Poster frame and probing, the same as any other new video.
  await enqueue('process-media', { mediaAssetId: asset.id }, { workspaceId: asset.workspaceId });
}

interface MuxSettings {
  audioAssetId: string;
  seconds: number | null;
  startSeconds: number;
}

function readMuxSettings(value: string | null): MuxSettings | null {
  if (!value?.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(value) as Partial<MuxSettings> & { kind?: string };
    if (parsed.kind !== 'audio-mux' || typeof parsed.audioAssetId !== 'string') return null;
    return {
      audioAssetId: parsed.audioAssetId,
      seconds: typeof parsed.seconds === 'number' ? parsed.seconds : null,
      startSeconds: typeof parsed.startSeconds === 'number' ? parsed.startSeconds : 0,
    };
  } catch {
    return null;
  }
}

function withSoundtrackName(original: string): string {
  const dot = original.lastIndexOf('.');
  return `${dot > 0 ? original.slice(0, dot) : original}-with-music.mp4`;
}
