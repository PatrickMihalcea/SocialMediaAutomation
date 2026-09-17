import 'server-only';
import type { MediaAsset, PostMedia, PostPlatform } from '@prisma/client';
import { storage } from '@/lib/storage';
import { renderSoundtrackedMedia } from '@/lib/media/audio-mux-derivative';
import type { OutgoingMedia, OutgoingPost } from '@/lib/social/types';

type MediaRow = PostMedia & { mediaAsset: MediaAsset };

/**
 * Turns stored rows into the shape adapters consume. Signed URLs are minted here
 * with a long enough life to survive a slow video transcode on the network's
 * side, and `read()` is lazy so a URL-pull adapter never downloads the bytes.
 */
export async function toOutgoingPost(
  row: PostPlatform & { media: MediaRow[] },
  title?: string | null,
): Promise<OutgoingPost> {
  const media = await Promise.all(
    [...row.media].sort((a, b) => a.position - b.position).map(toOutgoingMedia),
  );
  return {
    text: row.text,
    media,
    firstComment: row.firstComment,
    link: row.link,
    hashtags: row.hashtags,
    mentions: row.mentions,
    title: title ?? null,
  };
}

export async function toOutgoingMedia(row: MediaRow): Promise<OutgoingMedia> {
  // The soundtrack is rendered here, at the last possible moment, because this
  // is the first point where it is certain the post is actually going out.
  // While it was being composed it was only a choice, and choices change.
  const asset = row.mediaAsset;
  const soundtracked = row.audioAssetId
    ? await renderSoundtrackedMedia({
        sourceAssetId: row.mediaAssetId,
        audioAssetId: row.audioAssetId,
        startSeconds: row.audioStart ?? 0,
      })
    : null;
  // The rendered bytes stand in for the asset's, but the asset row is what the
  // library keeps — no second copy of the video appears there because someone
  // put a song on a post.
  const storageKey = soundtracked?.storageKey ?? asset.storageKey;
  const url = await storage().signedUrl(storageKey, 60 * 60 * 6);
  return {
    id: asset.id,
    // A soundtracked still is a video, and the adapters have to be told so:
    // they choose an upload endpoint from this.
    type: soundtracked ? 'VIDEO' : asset.type,
    mimeType: soundtracked?.mimeType ?? asset.mimeType,
    filename: soundtracked?.filename ?? asset.filename,
    // ?? not ||: a genuinely zero-byte render is a broken render, and
    // quietly substituting the original's size hides it until a platform
    // rejects the mismatch.
    size: soundtracked?.size ?? asset.size,
    width: soundtracked?.width ?? asset.width,
    height: soundtracked?.height ?? asset.height,
    durationSeconds: soundtracked?.duration ?? asset.duration,
    altText: row.altText ?? asset.altText,
    url,
    read: () => storage().get(storageKey),
  };
}
