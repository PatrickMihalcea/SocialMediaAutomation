'use server';

import { revalidatePath } from 'next/cache';
import { Platform } from '@prisma/client';
import { requireWorkspace } from '@/lib/auth/guard';
import { createDemoAccount } from '@/lib/social/accounts';
import { decryptAccount } from '@/lib/social/accounts';
import { db } from '@/lib/db';
import { assertWithinLimit } from '@/lib/billing/limits';
import { audit } from '@/lib/audit';
import { getAdapterForAccount } from '@/lib/social/registry';
import { consumeOAuthSelection, persistConnections, readOAuthSelection } from '@/lib/social/oauth';
import { encryptToken } from '@/lib/crypto/tokens';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { reconcilePostStatus } from '@/lib/publishing/engine';

export async function connectDemoChannelAction(slug: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'channel:connect');
  const limited = await rateLimit(`oauth:demo:${ctx.user.id}`, LIMITS.oauth.limit, LIMITS.oauth.window);
  if (!limited.allowed) throw new Error('Too many connection attempts. Try again shortly.');
  const platform = Platform[String(formData.get('platform')) as keyof typeof Platform];
  if (!platform || platform === Platform.MOCK) throw new Error('Choose a supported platform.');
  const count = await db.socialAccount.count({
    where: { workspaceId: ctx.workspace.id, status: { not: 'DISCONNECTED' } },
  });
  await assertWithinLimit(ctx.workspace.id, 'socialAccounts', count);
  const account = await createDemoAccount({
    workspaceId: ctx.workspace.id,
    platform,
    accountName: `${ctx.workspace.name} ${platformLabel(platform)}`,
    handle: `@${ctx.workspace.slug}`,
  });
  await audit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: 'channel.connected',
    entityType: 'social_account',
    entityId: account.id,
    metadata: { platform, mock: true },
  });
  revalidatePath(`/w/${slug}/channels`);
}

export async function disconnectChannelAction(slug: string, accountId: string) {
  const ctx = await requireWorkspace(slug, 'channel:disconnect');
  const limited = await rateLimit(`oauth:disconnect:${ctx.user.id}`, LIMITS.oauth.limit, LIMITS.oauth.window);
  if (!limited.allowed) throw new Error('Too many channel changes. Try again shortly.');
  const account = await db.socialAccount.findFirst({
    where: { id: accountId, workspaceId: ctx.workspace.id },
  });
  if (!account) return;
  let revokeFailed = false;
  try {
    await getAdapterForAccount(account).disconnect(decryptAccount(account));
  } catch (error) {
    revokeFailed = true;
    console.error(`[oauth] revoke failed for ${account.platform} ${account.id}`, error);
  }
  const affected = await db.postPlatform.findMany({
    where: {
      socialAccountId: account.id,
      workspaceId: ctx.workspace.id,
      status: 'PENDING',
      post: { status: 'SCHEDULED', scheduledAt: { gt: new Date() } },
    },
    select: { postId: true },
  });
  const affectedPostIds = [...new Set(affected.map((target) => target.postId))];
  await db.$transaction([
    db.socialAccount.update({
      where: { id: account.id },
      data: {
        status: 'DISCONNECTED',
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        statusMessage: 'Disconnected by a workspace administrator.',
      },
    }),
    db.postPlatform.updateMany({
      where: {
        socialAccountId: account.id,
        workspaceId: ctx.workspace.id,
        status: 'PENDING',
        postId: { in: affectedPostIds },
      },
      data: {
        status: 'CANCELLED',
        errorCode: null,
        errorMessage: 'Channel disconnected before its scheduled publishing time.',
      },
    }),
  ]);
  await Promise.all(affectedPostIds.map(async (postId) => {
    await reconcilePostStatus(postId);
    await audit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: 'post.channel_cancelled',
      entityType: 'post',
      entityId: postId,
      metadata: { socialAccountId: account.id, reason: 'channel_disconnected' },
    });
  }));
  await audit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: 'channel.disconnected',
    entityType: 'social_account',
    entityId: account.id,
    metadata: { platform: account.platform, revokeFailed, affectedPostIds },
  });
  revalidatePath(`/w/${slug}/channels`);
  revalidatePath(`/w/${slug}/calendar`);
}

export async function reconnectDemoChannelAction(slug: string, accountId: string) {
  const ctx = await requireWorkspace(slug, 'channel:connect');
  const limited = await rateLimit(`oauth:reconnect:${ctx.user.id}`, LIMITS.oauth.limit, LIMITS.oauth.window);
  if (!limited.allowed) throw new Error('Too many connection attempts. Try again shortly.');
  const account = await db.socialAccount.findFirst({
    where: { id: accountId, workspaceId: ctx.workspace.id },
  });
  if (!account || !(account.metadata as { mock?: boolean })?.mock) return;
  await db.socialAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encryptToken(`demo-token-${account.externalAccountId}-${Date.now()}`),
      tokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      status: 'ACTIVE',
      statusMessage: null,
      lastSyncedAt: new Date(),
    },
  });
  await audit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: 'channel.reconnected',
    entityType: 'social_account',
    entityId: account.id,
    metadata: { platform: account.platform, mock: true },
  });
  revalidatePath(`/w/${slug}/channels`);
}

export async function completeOAuthSelectionAction(slug: string, secret: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'channel:connect');
  const limited = await rateLimit(`oauth:selection:${ctx.user.id}`, LIMITS.oauth.limit, LIMITS.oauth.window);
  if (!limited.allowed) throw new Error('Too many connection attempts. Try again shortly.');
  const pending = await readOAuthSelection(secret, ctx.user.id);
  if (!pending || pending.workspaceId !== ctx.workspace.id) throw new Error('That selection expired. Connect the channel again.');
  const selected = formData.getAll('account').map(String);
  if (!selected.length) throw new Error('Select at least one account.');
  const selectedResults = pending.results.filter((result) => selected.includes(result.externalAccountId));
  const [current, existing] = await Promise.all([
    db.socialAccount.count({ where: { workspaceId: ctx.workspace.id, status: { not: 'DISCONNECTED' } } }),
    db.socialAccount.count({
      where: {
        workspaceId: ctx.workspace.id,
        platform: pending.platform,
        externalAccountId: { in: selectedResults.map((result) => result.externalAccountId) },
        status: { not: 'DISCONNECTED' },
      },
    }),
  ]);
  await assertWithinLimit(ctx.workspace.id, 'socialAccounts', current + selectedResults.length - existing);
  const consumed = await consumeOAuthSelection(secret, ctx.user.id, selected);
  if (!consumed || consumed.row.workspaceId !== ctx.workspace.id) throw new Error('That selection is invalid or was already used.');
  const saved = await persistConnections({
    workspaceId: ctx.workspace.id,
    platform: consumed.row.platform,
    results: consumed.results,
    reconnectAccountId: consumed.row.reconnectAccountId,
  });
  await Promise.all(saved.map((account) => audit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: consumed.row.reconnectAccountId ? 'channel.reconnected' : 'channel.connected',
    entityType: 'social_account',
    entityId: account.id,
    metadata: { platform: consumed.row.platform, externalAccountId: account.externalAccountId },
  })));
  revalidatePath(`/w/${slug}/channels`);
  const { redirect } = await import('next/navigation');
  redirect(`/w/${slug}/channels?oauth=${consumed.row.reconnectAccountId ? 'reconnected' : 'connected'}`);
}

function platformLabel(platform: Platform) {
  return { INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook', LINKEDIN: 'LinkedIn', X: 'X', TIKTOK: 'TikTok', YOUTUBE: 'YouTube', MOCK: 'Demo' }[platform];
}
