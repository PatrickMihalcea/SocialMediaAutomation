import 'server-only';
import { Platform, PostPlatformStatus, PostStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { getUsableAccount, markExpired } from '@/lib/social/accounts';
import { getAdapterForAccount } from '@/lib/social/registry';
import { PlatformError } from '@/lib/social/errors';
import { toOutgoingPost } from '@/lib/publishing/payload';
import { PermanentJobError } from '@/lib/queue/runner';
import { enqueue } from '@/lib/queue';
import { notifyWorkspace } from '@/lib/notifications/service';
import { audit } from '@/lib/audit';
import { assertStoredPostValid } from '@/lib/posts/service';

export const STALE_PUBLISHING_CLAIM_MS = 10 * 60 * 1000;

/**
 * The publishing engine.
 *
 * It knows about posts, channels, retries and idempotency. It knows nothing
 * about any specific network — every outbound call goes through
 * SocialPlatformAdapter, which is what lets a new platform be added without
 * touching this file.
 */

/** Fan a scheduled post out to one job per channel. */
export async function publishPost(postId: string): Promise<void> {
  const post = await db.post.findUnique({
    where: { id: postId },
    include: { platforms: { select: { id: true, status: true } } },
  });
  if (!post) throw new PermanentJobError(`Post ${postId} no longer exists`);

  if (post.status === PostStatus.CANCELLED) {
    console.log(`[publishing] post ${postId} was cancelled before its slot; skipping`);
    return;
  }
  if (post.status === PostStatus.PUBLISHED) return;

  try {
    await assertStoredPostValid(post.workspaceId, post.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The post is no longer valid.';
    await db.post.update({ where: { id: post.id }, data: { status: PostStatus.FAILED } });
    throw new PermanentJobError(message);
  }

  await db.post.update({ where: { id: postId }, data: { status: PostStatus.PUBLISHING } });

  const pending = post.platforms.filter(
    (p) => p.status === PostPlatformStatus.PENDING || p.status === PostPlatformStatus.FAILED,
  );
  await Promise.all(
    pending.map((p) =>
      enqueue('publish-post-platform', { postPlatformId: p.id }, { workspaceId: post.workspaceId }),
    ),
  );

  // Nothing left to publish means every channel already resolved.
  if (pending.length === 0) await reconcilePostStatus(postId);
}

/**
 * Publish one channel's version of a post.
 *
 * Idempotency has three layers:
 *  1. An already-PUBLISHED row returns immediately.
 *  2. The row is claimed with a conditional update, so two workers cannot both
 *     enter the publish call.
 *  3. When a previous attempt recorded a platform post id, the adapter is asked
 *     whether that post still exists before anything is sent again — this is the
 *     case that would otherwise double-post after an ambiguous timeout.
 */
export async function publishPostPlatform(postPlatformId: string): Promise<void> {
  const existing = await db.postPlatform.findUnique({
    where: { id: postPlatformId },
    include: { post: true },
  });
  if (!existing) throw new PermanentJobError(`Channel version ${postPlatformId} no longer exists`);

  if (existing.status === PostPlatformStatus.PUBLISHED) return;
  if (
    existing.status === PostPlatformStatus.CANCELLED ||
    existing.post.status === PostStatus.CANCELLED
  ) {
    return;
  }

  const staleBefore = new Date(Date.now() - STALE_PUBLISHING_CLAIM_MS);
  const claimed = await db.postPlatform.updateMany({
    where: {
      id: postPlatformId,
      OR: [
        { status: { in: [PostPlatformStatus.PENDING, PostPlatformStatus.FAILED] } },
        { status: PostPlatformStatus.PUBLISHING, updatedAt: { lt: staleBefore } },
      ],
    },
    data: { status: PostPlatformStatus.PUBLISHING, attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    console.log(`[publishing] ${postPlatformId} is already being published; skipping`);
    return;
  }

  const row = await db.postPlatform.findUniqueOrThrow({
    where: { id: postPlatformId },
    include: {
      post: true,
      media: { include: { mediaAsset: true } },
      socialAccount: true,
    },
  });
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: row.workspaceId },
    select: { slug: true },
  });

  try {
    const { row: accountRow, account } = await getUsableAccount(row.socialAccountId);
    const adapter = getAdapterForAccount(accountRow);

    // Layer 3 — a recorded id from an earlier attempt means it may already be live.
    if (row.platformPostId) {
      const upstream = await adapter.getPost(account, row.platformPostId).catch(() => null);
      if (upstream?.exists) {
        await recordPublished(row.id, {
          platformPostId: upstream.platformPostId,
          url: upstream.url,
          publishedAt: upstream.publishedAt ?? new Date(),
          raw: { recoveredFromPreviousAttempt: true },
        });
        await reconcilePostStatus(row.postId);
        return;
      }
    }

    const outgoing = await toOutgoingPost(row, row.post.title);

    // Validate against the live capability table one last time — media or
    // network limits may have changed since the composer approved it.
    const blocking = adapter.validatePost(outgoing).filter((i) => i.severity === 'error');
    if (blocking.length > 0) {
      throw new PermanentJobError(blocking.map((i) => i.message).join(' '));
    }

    await audit({
      workspaceId: row.workspaceId,
      action: 'post.publish_attempted',
      entityType: 'post_platform',
      entityId: row.id,
      metadata: { platform: row.platform, attempt: row.attempts },
    });
    const result = await adapter.publish({
      account,
      post: outgoing,
      idempotencyKey: row.idempotencyKey,
    });

    await recordPublished(row.id, result);
    await db.socialAccount.update({
      where: { id: accountRow.id },
      data: { lastSyncedAt: new Date() },
    });

    await audit({
      workspaceId: row.workspaceId,
      action: 'post.published',
      entityType: 'post_platform',
      entityId: row.id,
      metadata: { platform: row.platform, platformPostId: result.platformPostId },
    });

    // Measure it once the network has had time to count anything.
    await enqueue(
      'sync-post-analytics',
      { postPlatformId: row.id },
      { workspaceId: row.workspaceId, runAt: new Date(Date.now() + 60 * 60 * 1000) },
    );
  } catch (error) {
    await handleFailure(row.id, row.postId, row.workspaceId, workspace.slug, row.socialAccountId, row.platform, error);
    throw error;
  } finally {
    await reconcilePostStatus(row.postId);
  }
}

async function recordPublished(
  postPlatformId: string,
  result: { platformPostId: string; url?: string; publishedAt: Date; raw?: Record<string, unknown> },
): Promise<void> {
  await db.postPlatform.update({
    where: { id: postPlatformId },
    data: {
      status: PostPlatformStatus.PUBLISHED,
      platformPostId: result.platformPostId,
      platformUrl: result.url ?? null,
      publishedAt: result.publishedAt,
      errorMessage: null,
      errorCode: null,
      responseMeta: (result.raw ?? {}) as never,
    },
  });
}

async function handleFailure(
  postPlatformId: string,
  postId: string,
  workspaceId: string,
  workspaceSlug: string,
  socialAccountId: string,
  platform: Platform,
  error: unknown,
): Promise<void> {
  const platformError = error instanceof PlatformError ? error : null;
  const message =
    platformError?.message ??
    (error instanceof Error ? error.message : 'Bridge88 could not publish this post.');

  await db.postPlatform.update({
    where: { id: postPlatformId },
    data: {
      status: PostPlatformStatus.FAILED,
      errorMessage: message,
      errorCode: platformError?.code ?? 'UNKNOWN',
    },
  });

  // Log the provider's own words server-side; the user only ever sees `message`.
  console.error('[publishing] channel publish failed', {
    postPlatformId,
    code: platformError?.code,
    detail: platformError?.detail,
  });

  if (platformError?.needsReconnect) {
    const account = await db.socialAccount.findUnique({ where: { id: socialAccountId } });
    if (account) await markExpired(account, platformError.message);
  }

  await audit({
    workspaceId,
    action: 'post.publish_failed',
    entityType: 'post_platform',
    entityId: postPlatformId,
    metadata: {
      platform,
      code: platformError?.code ?? 'UNKNOWN',
      error: auditFailureReason(platformError),
      retryable: platformError?.retryable ?? false,
    },
  });
  await notifyWorkspace(workspaceId, {
    type: 'POST_FAILED',
    title: 'A post did not publish',
    body: message,
    href: `/w/${workspaceSlug}/calendar?post=${encodeURIComponent(postId)}`,
  });
}

function auditFailureReason(error: PlatformError | null): string {
  if (error?.code === 'AUTH') return 'TOKEN_EXPIRED';
  if (error?.code === 'RATE_LIMIT') return 'RATE_LIMITED';
  if (error?.code === 'REJECTED') return 'VALIDATION_FAILED';
  if (error?.retryable) return 'The social network was unavailable, so another attempt was scheduled';
  return 'The social network did not accept this publishing attempt';
}

/**
 * A post's status is derived from its channels: every channel published means
 * PUBLISHED, any still pending means PUBLISHING, otherwise FAILED. Partial
 * success is reported as FAILED so the user is never told a post went out when
 * one of its channels did not.
 */
export async function reconcilePostStatus(postId: string): Promise<void> {
  const post = await db.post.findUnique({
    where: { id: postId },
    include: {
      workspace: { select: { slug: true } },
      platforms: {
        select: {
          status: true,
          publishedAt: true,
          socialAccount: { select: { metadata: true } },
        },
      },
    },
  });
  if (!post || post.platforms.length === 0) return;

  const statuses = post.platforms.map((p) => p.status);
  const settled = statuses.every(
    (s) =>
      s === PostPlatformStatus.PUBLISHED ||
      s === PostPlatformStatus.FAILED ||
      s === PostPlatformStatus.SKIPPED ||
      s === PostPlatformStatus.CANCELLED,
  );
  if (!settled) return;

  const anyPublished = statuses.includes(PostPlatformStatus.PUBLISHED);
  const anyFailed = statuses.includes(PostPlatformStatus.FAILED);
  const status = anyFailed ? PostStatus.FAILED : anyPublished ? PostStatus.PUBLISHED : PostStatus.CANCELLED;

  const publishedAt = post.platforms
    .map((p) => p.publishedAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  await db.post.update({
    where: { id: postId },
    data: { status, publishedAt: publishedAt ?? post.publishedAt },
  });

  if (status === PostStatus.PUBLISHED) {
    const publishedCount = statuses.filter((channelStatus) => channelStatus === PostPlatformStatus.PUBLISHED).length;
    const simulatedCount = post.platforms.filter(
      (channel) => (channel.socialAccount.metadata as { mock?: boolean } | null)?.mock === true,
    ).length;
    const simulationNote =
      simulatedCount === post.platforms.length
        ? ' This was a simulation; no post was sent to a real social network.'
        : simulatedCount > 0
          ? ` ${simulatedCount} channel${simulatedCount === 1 ? ' was' : 's were'} simulated.`
          : '';
    await notifyWorkspace(post.workspaceId, {
      type: 'POST_PUBLISHED',
      title: post.title ? `"${post.title}" published` : 'A post published',
      body: `Published to ${publishedCount} channel${publishedCount === 1 ? '' : 's'}.${simulationNote}`,
      href: `/w/${post.workspace.slug}/calendar?post=${encodeURIComponent(post.id)}`,
    });
  }
}

/**
 * Finds posts whose slot has arrived and queues them. Runs on a short interval;
 * the dedupe key means a post cannot be queued twice even if two ticks overlap.
 */
export async function scanDuePosts(): Promise<{ queued: number }> {
  const due = await db.post.findMany({
    where: {
      status: PostStatus.SCHEDULED,
      scheduledAt: { lte: new Date() },
      workspace: { queuePaused: false },
    },
    select: { id: true, workspaceId: true },
    take: 100,
  });

  for (const post of due) {
    await enqueue('publish-post', { postId: post.id }, { workspaceId: post.workspaceId, dedupeKey: `publish:${post.id}` });
  }
  return { queued: due.length };
}
