import 'server-only';
import { notFound } from '@/lib/errors';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { utcToLocalInput } from '@/lib/scheduling/time';
import type { ComposerAccount, ComposerAsset, ComposerCampaign, ComposerInitial } from '@/lib/posts/composer';

export async function loadComposerContext(
  workspaceId: string,
  slug: string,
  postId?: string,
  requestedAssetId?: string,
) {
  const [workspace, preferences, accounts, campaigns, post] = await Promise.all([
    db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { timezone: true },
    }),
    db.workspacePreferences.findUnique({ where: { workspaceId } }),
    db.socialAccount.findMany({
      where: { workspaceId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, accountName: true, accountHandle: true, platform: true, metadata: true },
    }),
    db.campaign.findMany({
      where: { workspaceId, status: { in: ['PLANNED', 'ACTIVE'] } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, color: true },
    }),
    postId
      ? db.post.findFirst({
          where: { id: postId, workspaceId },
          include: {
            platforms: {
              orderBy: { createdAt: 'asc' },
              include: {
                media: {
                  orderBy: { position: 'asc' },
                  select: {
                    mediaAssetId: true,
                    altText: true,
                    thumbnailOffset: true,
                    audioAssetId: true,
                    audioStart: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  if (postId && !post) throw notFound('That post no longer exists.');

  const mediaSelect = {
    id: true,
    filename: true,
    thumbnailKey: true,
    storageKey: true,
    type: true,
    status: true,
    /** Audio only, and only read for the soundtrack list; null on everything else. */
    audioStart: true,
  } as const;
  const attachedMediaIds = [
    ...new Set(post?.platforms.flatMap((platform) =>
      platform.media.map((item) => item.mediaAssetId)) ?? []),
  ];
  if (requestedAssetId) attachedMediaIds.push(requestedAssetId);
  const [recentMedia, attachedMedia, audioTracks] = await Promise.all([
    db.mediaAsset.findMany({
      where: { workspaceId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: mediaSelect,
    }),
    attachedMediaIds.length
      ? db.mediaAsset.findMany({
          // Attached media includes anything still rendering. Filtering to
          // READY made an asset the composer had only just created read as
          // "no longer available", which is both wrong and alarming.
          where: { workspaceId, id: { in: attachedMediaIds }, status: { in: ['READY', 'PROCESSING'] } },
          select: mediaSelect,
        })
      : Promise.resolve([]),
    // Separately from the twelve most recent of everything: a soundtrack is
    // chosen long after it was uploaded, so the track someone wants is rarely
    // among the last dozen things they added.
    db.mediaAsset.findMany({
      where: { workspaceId, status: 'READY', type: 'AUDIO' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: mediaSelect,
    }),
  ]);
  const media = [
    ...new Map(
      [...attachedMedia, ...recentMedia].map((asset) => [asset.id, asset]),
    ).values(),
  ];

  const postAccountIds = post?.platforms.map((p) => p.socialAccountId) ?? [];
  const missingAccounts = postAccountIds.length
    ? await db.socialAccount.findMany({
        where: { workspaceId, id: { in: postAccountIds }, status: { not: 'ACTIVE' } },
        select: { id: true, accountName: true, accountHandle: true, platform: true, metadata: true },
      })
    : [];

  const mergedAccounts: ComposerAccount[] = [
    ...accounts,
    ...missingAccounts.filter((a) => !accounts.some((x) => x.id === a.id)),
  ].map((account) => ({
    id: account.id,
    accountName: account.accountName,
    accountHandle: account.accountHandle,
    platform: account.platform,
    isDemo: Boolean(
      account.metadata &&
      typeof account.metadata === 'object' &&
      !Array.isArray(account.metadata) &&
      (account.metadata as Record<string, unknown>).mock === true
    ),
  }));

  const mediaStorage = storage();
  const assets: ComposerAsset[] = await Promise.all(
    media.map(async (asset) => ({
      id: asset.id,
      filename: asset.filename,
      type: asset.type,
      status: asset.status,
      url: await mediaStorage.signedUrl(asset.storageKey),
      thumbnailUrl: await mediaStorage.signedUrl(asset.thumbnailKey ?? asset.storageKey),
    })),
  );

  const tracks: ComposerAsset[] = await Promise.all(
    audioTracks.map(async (asset) => ({
      id: asset.id,
      filename: asset.filename,
      type: asset.type,
      status: asset.status,
      url: await mediaStorage.signedUrl(asset.storageKey),
      thumbnailUrl: await mediaStorage.signedUrl(asset.thumbnailKey ?? asset.storageKey),
      // Seeds the start box when this track is attached to a post.
      audioStart: asset.audioStart,
    })),
  );

  const initial: ComposerInitial | undefined = post
    ? {
        title: post.title,
        campaignId: post.campaignId,
        scheduledAt: post.scheduledAt ? utcToLocalInput(post.scheduledAt, workspace.timezone) : null,
        updatedAt: post.updatedAt.toISOString(),
        status: post.status,
        platforms: post.platforms.map((platform) => ({
          socialAccountId: platform.socialAccountId,
          platform: platform.platform,
          text: platform.text,
          firstComment: platform.firstComment,
          hashtags: platform.hashtags,
          mentions: platform.mentions,
          link: platform.link,
          media: platform.media.map((item) => ({
            mediaAssetId: item.mediaAssetId,
            altText: item.altText,
            thumbnailOffset: item.thumbnailOffset,
            audioAssetId: item.audioAssetId,
            audioStart: item.audioStart,
          })),
        })),
      }
    : undefined;

  return {
    slug,
    timezone: workspace.timezone,
    accounts: mergedAccounts,
    assets,
    audioTracks: tracks,
    campaigns: campaigns as ComposerCampaign[],
    preferences,
    post: post ? { id: post.id, status: post.status } : null,
    initial,
  };
}
