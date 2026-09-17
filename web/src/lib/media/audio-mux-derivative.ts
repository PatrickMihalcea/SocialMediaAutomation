import 'server-only';
import { createHash } from 'node:crypto';
import { MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { PermanentJobError } from '@/lib/queue/runner';
import { storage } from '@/lib/storage';
import { renderer } from '@/lib/render';
import { buildAudioMuxPlan, type MuxSource } from '@/lib/media/audio-mux';

/**
 * The publishable version of an asset with its soundtrack on it.
 *
 * Deliberately not a library asset. Choosing a track is an edit to the post,
 * not to the media: the original stays the one thing in the library, and adding
 * music to it three different ways does not leave three near-identical videos
 * behind for someone to sort out later. What the platform needs is bytes, and
 * bytes live in storage perfectly well without a row describing them.
 *
 * The key is derived from everything that determines the output, so publishing
 * to four channels, retrying a failed one and republishing all reuse a single
 * encode — and a second attempt costs a HEAD request rather than a minute of
 * ffmpeg.
 */
export interface RenderedSoundtrack {
  storageKey: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  filename: string;
}

export async function renderSoundtrackedMedia(input: {
  sourceAssetId: string;
  audioAssetId: string;
  startSeconds: number;
  seconds?: number | null;
}): Promise<RenderedSoundtrack> {
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

  const filename = withSoundtrackName(source.filename);
  const key = soundtrackKey(source.workspaceId, {
    sourceAssetId: source.id,
    audioAssetId: audio.id,
    startSeconds: input.startSeconds,
    seconds: input.seconds ?? null,
    // Part of the identity: re-uploading different bytes under the same asset
    // id must not serve the previous render.
    sourceUpdatedAt: source.updatedAt.toISOString(),
  });

  if (await storage().exists(key)) {
    // Measured, not guessed. Returning 0 here let the caller fall back to the
    // source asset's size while serving these bytes, and an upload that
    // declares one length and sends another is rejected outright — YouTube
    // says so in exactly those words.
    const cached = await storage().get(key);
    return {
      storageKey: key,
      mimeType: 'video/mp4',
      size: cached.byteLength,
      width: source.width,
      height: source.height,
      duration: source.duration,
      filename,
    };
  }

  if (!(await renderer().isAvailable())) {
    // Refused, never published silently: sending the original as though the
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

  await storage().put(key, result.data, result.mimeType);
  return {
    storageKey: key,
    mimeType: result.mimeType,
    size: result.data.byteLength,
    width: result.width,
    height: result.height,
    duration: result.durationSeconds,
    filename,
  };
}

/** Everything that changes the output, and nothing that does not. */
function soundtrackKey(workspaceId: string, parts: Record<string, string | number | null>): string {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
  return `workspaces/${workspaceId}/soundtracked/${digest}.mp4`;
}

function withSoundtrackName(original: string): string {
  const dot = original.lastIndexOf('.');
  return `${dot > 0 ? original.slice(0, dot) : original}-with-music.mp4`;
}
