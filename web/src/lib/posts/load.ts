import 'server-only';
import { notFound } from '@/lib/errors';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { utcToLocalInput } from '@/lib/scheduling/time';
import type { ComposerAccount, ComposerAsset, ComposerCampaign, ComposerInitial } from '@/lib/posts/composer';

export async function loadComposerContext(workspaceId: string, slug: string, postId?: string) {
  const [workspace, accounts, media, campaigns, post] = await Promise.all([
    db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { timezone: true },
    }),
    db.socialAccount.findMany({
      where: { workspaceId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, accountName: true, accountHandle: true, platform: true, metadata: true },
    }),
    db.mediaAsset.findMany({
      where: { workspaceId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { id: true, filename: true, thumbnailKey: true, storageKey: true, type: true },
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
                media: { orderBy: { position: 'asc' }, select: { mediaAssetId: true, altText: true, thumbnailOffset: true } },
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  if (postId && !post) throw notFound('That post no longer exists.');

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

  const assets: ComposerAsset[] = await Promise.all(
    media.map(async (asset) => ({
      id: asset.id,
      filename: asset.filename,
      type: asset.type,
      thumbnailUrl: await storage().signedUrl(asset.thumbnailKey ?? asset.storageKey),
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
          })),
        })),
      }
    : undefined;

  return {
    slug,
    timezone: workspace.timezone,
    accounts: mergedAccounts,
    assets,
    campaigns: campaigns as ComposerCampaign[],
    post: post ? { id: post.id, status: post.status } : null,
    initial,
  };
}
