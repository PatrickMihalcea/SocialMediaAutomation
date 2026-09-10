import 'server-only';
import { PostPlatformStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { getUsableAccount } from '@/lib/social/accounts';
import { getAdapterForAccount } from '@/lib/social/registry';
import { PermanentJobError } from '@/lib/queue/runner';
import { enqueue } from '@/lib/queue';
import { sumReported } from './aggregate';

/**
 * Analytics are pulled, never invented. Where a network does not report a
 * metric, the column stays null and the UI says "not reported" — the brief is
 * explicit that a missing metric must not be fabricated.
 */

export async function syncPostAnalytics(postPlatformId: string): Promise<void> {
  const row = await db.postPlatform.findUnique({ where: { id: postPlatformId } });
  if (!row) throw new PermanentJobError(`Channel version ${postPlatformId} no longer exists`);
  if (row.status !== PostPlatformStatus.PUBLISHED || !row.platformPostId) return;

  const { row: accountRow, account } = await getUsableAccount(row.socialAccountId);
  const adapter = getAdapterForAccount(accountRow);
  if (!adapter.capabilities.supportsPostAnalytics) return;

  const metrics = await adapter.getPostAnalytics(account, row.platformPostId);
  const engagements = sumReported([
    metrics.likes ?? null,
    metrics.comments ?? null,
    metrics.shares ?? null,
    metrics.saves ?? null,
  ]);
  const denominator = metrics.impressions ?? metrics.reach ?? null;
  const engagementRate = denominator && engagements !== null ? engagements / denominator : null;

  await db.postAnalytics.upsert({
    where: { postPlatformId },
    create: {
      workspaceId: row.workspaceId,
      postPlatformId,
      platform: row.platform,
      ...metrics,
      raw: (metrics.raw ?? {}) as never,
      engagementRate,
      fetchedAt: new Date(),
    },
    update: {
      ...metrics,
      raw: (metrics.raw ?? {}) as never,
      engagementRate,
      fetchedAt: new Date(),
    },
  });
}

export async function syncAccountAnalytics(socialAccountId: string): Promise<void> {
  const row = await db.socialAccount.findUnique({ where: { id: socialAccountId } });
  if (!row) throw new PermanentJobError(`Channel ${socialAccountId} no longer exists`);

  const { row: accountRow, account } = await getUsableAccount(socialAccountId);
  const adapter = getAdapterForAccount(accountRow);
  if (!adapter.capabilities.supportsAccountAnalytics) return;

  const metrics = await adapter.getAccountAnalytics(account);

  // One snapshot per channel per day; a re-run replaces the day's figures.
  const capturedOn = new Date();
  capturedOn.setUTCHours(0, 0, 0, 0);

  const postsPublished = await db.postPlatform.count({
    where: {
      socialAccountId,
      status: PostPlatformStatus.PUBLISHED,
      publishedAt: { gte: capturedOn },
    },
  });

  await db.analyticsSnapshot.upsert({
    where: { socialAccountId_capturedOn: { socialAccountId, capturedOn } },
    create: {
      workspaceId: row.workspaceId,
      socialAccountId,
      platform: row.platform,
      capturedOn,
      ...metrics,
      raw: (metrics.raw ?? {}) as never,
      postsPublished,
    },
    update: { ...metrics, raw: (metrics.raw ?? {}) as never, postsPublished },
  });

  await db.socialAccount.update({ where: { id: socialAccountId }, data: { lastSyncedAt: new Date() } });
}

/** Fans one workspace out into per-channel and per-post sync jobs. */
export async function syncWorkspaceAnalytics(workspaceId: string): Promise<void> {
  const accounts = await db.socialAccount.findMany({
    where: { workspaceId, status: 'ACTIVE' },
    select: { id: true },
  });
  for (const account of accounts) {
    await enqueue('sync-account-analytics', { socialAccountId: account.id }, { workspaceId });
  }

  // Refresh recent posts; older ones stop changing and are not worth the quota.
  const recent = await db.postPlatform.findMany({
    where: {
      workspaceId,
      status: PostPlatformStatus.PUBLISHED,
      publishedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    select: { id: true },
    take: 200,
  });
  for (const post of recent) {
    await enqueue('sync-post-analytics', { postPlatformId: post.id }, { workspaceId });
  }
}
