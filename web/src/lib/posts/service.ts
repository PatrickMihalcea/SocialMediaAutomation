import 'server-only';
import { PostPlatformStatus, PostStatus, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { conflict, invalid, notFound } from '@/lib/errors';
import { idempotencyKey } from '@/lib/publishing/idempotency';
import { getAdapterForAccount } from '@/lib/social/registry';
import { toOutgoingPost } from '@/lib/publishing/payload';
import { assertWithinLimit } from '@/lib/billing/limits';
import { audit } from '@/lib/audit';
import { notifyRoles } from '@/lib/notifications/service';
import { savePostSchema, type SavePostInput } from '@/lib/posts/schemas';

export async function validateDraft(
  workspaceId: string,
  input: SavePostInput,
): Promise<Record<string, string[]>> {
  const issues: Record<string, string[]> = {};
  for (const version of input.platforms) {
    const account = await db.socialAccount.findFirst({
      where: {
        id: version.socialAccountId,
        workspaceId,
        platform: version.platform,
        status: { not: 'DISCONNECTED' },
      },
    });
    if (!account) {
      issues[version.socialAccountId] = ['That social account is not connected to this workspace.'];
      continue;
    }

    const mediaAssets = await db.mediaAsset.findMany({
      where: {
        workspaceId,
        id: { in: version.media.map((item) => item.mediaAssetId) },
        status: 'READY',
      },
    });
    if (mediaAssets.length !== version.media.length) {
      issues[version.socialAccountId] = [
        ...(issues[version.socialAccountId] ?? []),
        'One or more media files are missing or still processing.',
      ];
      continue;
    }

    const adapter = getAdapterForAccount(account);
    const outgoing = {
      text: version.text,
      firstComment: version.firstComment,
      hashtags: version.hashtags,
      mentions: version.mentions,
      link: version.link || null,
      title: input.title,
      media: mediaAssets.map((asset) => ({
        id: asset.id,
        type: asset.type,
        mimeType: asset.mimeType,
        filename: asset.filename,
        size: asset.size,
        width: asset.width,
        height: asset.height,
        durationSeconds: asset.duration,
        altText:
          version.media.find((item) => item.mediaAssetId === asset.id)?.altText ??
          asset.altText,
        url: '',
        read: async () => Buffer.alloc(0),
      })),
    };
    const messages = adapter
      .validatePost(outgoing)
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message);
    if (messages.length) issues[version.socialAccountId] = messages;
  }
  return issues;
}

export async function savePost(
  workspaceId: string,
  authorId: string,
  raw: SavePostInput,
) {
  let input = savePostSchema.parse(raw);
  let source = input.id
    ? await db.post.findFirst({
        where: { id: input.id, workspaceId },
        include: { platforms: { select: { status: true } } },
      })
    : null;
  if (input.id && !source) throw notFound('That post no longer exists.');
  if (source?.status === PostStatus.PUBLISHING) {
    throw conflict('This post is currently publishing and cannot be edited.');
  }
  if (
    source &&
    input.expectedUpdatedAt &&
    source.updatedAt.getTime() !== input.expectedUpdatedAt.getTime() &&
    source.status !== PostStatus.PUBLISHED
  ) {
    throw conflict('This post changed in another session. Reload it before saving so those changes are not overwritten.');
  }

  // A live post (including a partial publish) is immutable. Saving from its edit
  // screen creates a new draft with the submitted versions.
  const duplicateInstead =
    source?.status === PostStatus.PUBLISHED ||
    source?.platforms.some((platform) => platform.status === PostPlatformStatus.PUBLISHED);
  if (duplicateInstead) {
    input = { ...input, id: undefined, status: PostStatus.DRAFT, scheduledAt: null };
    source = null;
  }

  if (input.campaignId) {
    const campaign = await db.campaign.findFirst({
      where: { id: input.campaignId, workspaceId },
      select: { id: true },
    });
    if (!campaign) throw invalid('That campaign is not available in this workspace.');
  }
  const isScheduling =
    input.status === PostStatus.SCHEDULED || input.status === PostStatus.APPROVED;

  if (isScheduling) {
    if (!input.scheduledAt) throw invalid('Choose a date and time before scheduling.');
    if (input.scheduledAt.getTime() <= Date.now()) {
      throw invalid('Choose a publishing time in the future.');
    }
    const scheduledCount = await db.post.count({
      where: { workspaceId, status: PostStatus.SCHEDULED },
    });
    await assertWithinLimit(workspaceId, 'scheduledPosts', scheduledCount);
  }

  const fieldIssues = await validateDraft(workspaceId, input);
  if (Object.keys(fieldIssues).length) {
    throw invalid('Fix the platform-specific issues before saving this post.', fieldIssues);
  }

  let result;
  try {
    result = await db.$transaction(async (tx) => {
    const previousMediaIds = input.id
      ? (
          await tx.postMedia.findMany({
            where: { postPlatform: { postId: input.id, workspaceId } },
            select: { mediaAssetId: true },
          })
        ).map((media) => media.mediaAssetId)
      : [];
    const post = input.id
      ? await tx.post.update({
          where: {
            id: input.id,
            workspaceId,
            ...(input.expectedUpdatedAt ? { updatedAt: input.expectedUpdatedAt } : {}),
          },
          data: {
            title: input.title,
            campaignId: input.campaignId,
            status: input.status,
            scheduledAt: input.scheduledAt,
            timezone: input.timezone,
          },
        })
      : await tx.post.create({
          data: {
            workspaceId,
            authorId,
            title: input.title,
            campaignId: input.campaignId,
            status: input.status,
            scheduledAt: input.scheduledAt,
            timezone: input.timezone,
          },
        });

    if (input.id) await tx.postPlatform.deleteMany({ where: { postId: post.id, workspaceId } });

    for (const version of input.platforms) {
      const platform = await tx.postPlatform.create({
        data: {
          postId: post.id,
          workspaceId,
          socialAccountId: version.socialAccountId,
          platform: version.platform,
          text: version.text,
          firstComment: version.firstComment || null,
          hashtags: version.hashtags,
          mentions: version.mentions,
          link: version.link || null,
          idempotencyKey: idempotencyKey(post.id, version.socialAccountId),
        },
      });
      if (version.media.length) {
        await tx.postMedia.createMany({
          data: version.media.map((item, position) => ({
            postPlatformId: platform.id,
            mediaAssetId: item.mediaAssetId,
            position,
            altText: item.altText || null,
            thumbnailOffset: item.thumbnailOffset,
          })),
        });
      }
    }
    const nextMediaIds = input.platforms.flatMap((version) =>
      version.media.map((media) => media.mediaAssetId),
    );
    await syncMediaUsage(tx, [...new Set([...previousMediaIds, ...nextMediaIds])]);
      return post;
    });
  } catch (error) {
    if (
      input.id &&
      input.expectedUpdatedAt &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw conflict('This post changed in another session. Reload it before saving so those changes are not overwritten.');
    }
    throw error;
  }

  await audit({
    workspaceId,
    userId: authorId,
    action: input.id ? 'post.updated' : duplicateInstead ? 'post.duplicated' : 'post.created',
    entityType: 'post',
    entityId: result.id,
    metadata: { status: result.status, platformCount: input.platforms.length },
  });

  if (result.status === PostStatus.PENDING_APPROVAL) {
    const workspace = await db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { slug: true },
    });
    await notifyRoles(workspaceId, ['OWNER', 'ADMIN'], {
      type: 'APPROVAL_REQUESTED',
      title: 'A post is ready for review',
      body: result.title ?? 'An untitled post was submitted for approval.',
      href: `/w/${workspace.slug}/calendar?post=${result.id}`,
    });
  }
  return result;
}

export async function duplicatePost(workspaceId: string, postId: string, authorId: string) {
  const source = await db.post.findFirst({
    where: { id: postId, workspaceId },
    include: { platforms: { include: { media: true } } },
  });
  if (!source) throw notFound('That post no longer exists.');

  return db.$transaction(async (tx) => {
    const copy = await tx.post.create({
      data: {
        workspaceId,
        authorId,
        campaignId: source.campaignId,
        status: PostStatus.DRAFT,
        title: source.title ? `${source.title} copy` : 'Post copy',
        timezone: source.timezone,
      },
    });
    for (const version of source.platforms) {
      const created = await tx.postPlatform.create({
        data: {
          postId: copy.id,
          workspaceId,
          socialAccountId: version.socialAccountId,
          platform: version.platform,
          text: version.text,
          firstComment: version.firstComment,
          hashtags: version.hashtags,
          mentions: version.mentions,
          link: version.link,
          idempotencyKey: idempotencyKey(copy.id, version.socialAccountId),
        },
      });
      if (version.media.length) {
        await tx.postMedia.createMany({
          data: version.media.map((media) => ({
            postPlatformId: created.id,
            mediaAssetId: media.mediaAssetId,
            position: media.position,
            altText: media.altText,
            thumbnailOffset: media.thumbnailOffset,
          })),
        });
      }
    }
    await syncMediaUsage(
      tx,
      [...new Set(source.platforms.flatMap((version) => version.media.map((media) => media.mediaAssetId)))],
    );
    return copy;
  });
}

export async function deletePost(workspaceId: string, postId: string) {
  const post = await db.post.findFirst({
    where: { id: postId, workspaceId },
    include: { platforms: { include: { media: { select: { mediaAssetId: true } } } } },
  });
  if (!post) throw notFound('That post no longer exists.');
  if (post.status === PostStatus.PUBLISHING) {
    throw conflict('This post is currently publishing and cannot be deleted.');
  }
  const mediaIds = [
    ...new Set(post.platforms.flatMap((platform) => platform.media.map((media) => media.mediaAssetId))),
  ];
  await db.$transaction(async (tx) => {
    await tx.post.delete({ where: { id: post.id, workspaceId } });
    await syncMediaUsage(tx, mediaIds);
  });
}

export async function validateStoredPost(workspaceId: string, postId: string) {
  const versions = await db.postPlatform.findMany({
    where: { postId, workspaceId, post: { workspaceId } },
    include: { post: true, socialAccount: true, media: { include: { mediaAsset: true } } },
  });
  if (!versions.length) throw notFound('That post no longer exists.');
  return Promise.all(
    versions.map(async (version) => ({
      socialAccountId: version.socialAccountId,
      issues: getAdapterForAccount(version.socialAccount).validatePost(
        await toOutgoingPost(version, version.post.title),
      ),
    })),
  );
}

export async function assertStoredPostValid(workspaceId: string, postId: string) {
  const results = await validateStoredPost(workspaceId, postId);
  const fields = Object.fromEntries(
    results
      .map((result) => [
        result.socialAccountId,
        result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message),
      ] as const)
      .filter(([, issues]) => issues.length),
  );
  if (Object.keys(fields).length) {
    throw invalid('Fix the platform-specific issues before publishing this post.', fields);
  }
}

/**
 * Publishing is a one-way door. A post may move to any future slot — earlier or
 * later than where it sits now — but once it has gone out to the platforms its
 * date is history, not a plan. A partial failure stays open to both a new date
 * and a retry: either one only re-sends the platform rows that never published.
 */
export function assertPostNotLive(post: { status: PostStatus }, intent: 'move' | 'publish' = 'move') {
  if (post.status === PostStatus.PUBLISHED) {
    throw invalid(
      intent === 'move'
        ? 'This post has already been published, so its date can no longer change. Duplicate it to post the same content again.'
        : 'This post has already been published. Duplicate it to post the same content again.',
    );
  }
  if (post.status === PostStatus.PUBLISHING) {
    throw invalid(
      intent === 'move'
        ? 'This post is publishing right now. Wait for it to finish before changing its date.'
        : 'This post is already publishing. Wait for it to finish.',
    );
  }
}

async function syncMediaUsage(tx: Prisma.TransactionClient, mediaAssetIds: string[]) {
  await Promise.all(
    mediaAssetIds.map(async (mediaAssetId) => {
      const usageCount = await tx.postMedia.count({ where: { mediaAssetId } });
      await tx.mediaAsset.update({ where: { id: mediaAssetId }, data: { usageCount } });
    }),
  );
}
