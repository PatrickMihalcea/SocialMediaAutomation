import 'server-only';
import { MediaStatus, MediaType, type MediaAsset } from '@prisma/client';
import { db } from '@/lib/db';
import { PermanentJobError } from '@/lib/queue/runner';
import { mediaKey, storage } from '@/lib/storage';
import { renderer } from '@/lib/render';
import { buildAudioMuxPlan, type MuxSource } from '@/lib/media/audio-mux';
import { enqueue } from '@/lib/queue';

/**
 * The soundtracked version of an asset, rendered if it does not exist yet.
 *
 * Called at publish time, not while composing. Choosing a track is a decision;
 * encoding is a consequence of publishing, and doing it up front meant every
 * change of mind burned an encode and left half-finished assets in the library.
 *
 * Cached by exactly what determines the output — source, track, start offset —
 * so republishing, retrying a failed platform, or posting the same media to
 * four channels all reuse one render.
 */
export async function soundtrackedAsset(input: {
  sourceAssetId: string;
  audioAssetId: string;
  startSeconds: number;
  seconds?: number | null;
  userId?: string;
}): Promise<MediaAsset> {
  const signature = muxSignature(input.audioAssetId, input.startSeconds, input.seconds ?? null);
  const existing = await db.mediaAsset.findFirst({
    where: {
      derivedFromId: input.sourceAssetId,
      derivationPreset: signature,
      status: { in: [MediaStatus.READY, MediaStatus.PROCESSING] },
      size: { gt: 0 },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;

  const [source, audio] = await Promise.all([
    db.mediaAsset.findUniqueOrThrow({ where: { id: input.sourceAssetId } }),
    db.mediaAsset.findUniqueOrThrow({ where: { id: input.audioAssetId } }),
  ]);
  if (source.workspaceId !== audio.workspaceId) {
    throw new PermanentJobError('The track and the media belong to different workspaces.');
  }
  if (audio.type !== MediaType.AUDIO) throw new PermanentJobError('The chosen soundtrack is not an audio file.');
  if (source.type !== MediaType.IMAGE && source.type !== MediaType.VIDEO) {
    throw new PermanentJobError('Only an image or a video can carry a soundtrack.');
  }
  if (!(await renderer().isAvailable())) {
    // Refused, never published silently: posting the original as though the
    // music were on it is the one outcome nobody could detect afterwards.
    throw new PermanentJobError(
      'This post has a soundtrack, which needs ffmpeg to render. The worker has it; this machine does not.',
    );
  }

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
        startSeconds: input.startSeconds,
      },
      requestedSeconds: input.seconds ?? null,
    }),
  );

  const filename = withSoundtrackName(source.filename);
  const key = mediaKey(source.workspaceId, filename, 'derived');
  await storage().put(key, result.data, result.mimeType);

  return db.mediaAsset.create({
    data: {
      workspaceId: source.workspaceId,
      folderId: source.folderId,
      uploadedById: input.userId ?? source.uploadedById,
      filename,
      mimeType: result.mimeType,
      // An image with a soundtrack is a video. No platform has a post type that
      // is a photograph with sound.
      type: MediaType.VIDEO,
      size: result.data.byteLength,
      width: result.width,
      height: result.height,
      duration: result.durationSeconds,
      storageKey: key,
      altText: source.altText,
      status: MediaStatus.READY,
      derivedFromId: source.id,
      derivationPreset: signature,
    },
  });
}

/** What determines the output, and therefore what a cached render must match. */
function muxSignature(audioAssetId: string, startSeconds: number, seconds: number | null): string {
  return JSON.stringify({ kind: 'audio-mux', audioAssetId, startSeconds, seconds });
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
