import 'server-only';
import type { MediaAsset, PostMedia, PostPlatform } from '@prisma/client';
import { storage } from '@/lib/storage';
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
  const asset = row.mediaAsset;
  const url = await storage().signedUrl(asset.storageKey, 60 * 60 * 6);
  return {
    id: asset.id,
    type: asset.type,
    mimeType: asset.mimeType,
    filename: asset.filename,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.duration,
    altText: row.altText ?? asset.altText,
    url,
    read: () => storage().get(asset.storageKey),
  };
}
