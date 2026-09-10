import 'server-only';
import { Platform, SocialAccountStatus, type SocialAccount } from '@prisma/client';
import { db } from '@/lib/db';
import { decryptOptional, encryptOptional } from '@/lib/crypto/tokens';
import { getAdapterForAccount } from '@/lib/social/registry';
import { PlatformError } from '@/lib/social/errors';
import type { DecryptedAccount } from '@/lib/social/types';
import { notify } from '@/lib/notifications/service';

/**
 * Tokens live encrypted at rest and are decrypted only for the duration of one
 * adapter call. Nothing in this module is safe to return to a client component.
 */
export function decryptAccount(account: SocialAccount): DecryptedAccount {
  return {
    id: account.id,
    workspaceId: account.workspaceId,
    platform: account.platform,
    externalAccountId: account.externalAccountId,
    accountName: account.accountName,
    accessToken: decryptOptional(account.accessTokenEncrypted),
    refreshToken: decryptOptional(account.refreshTokenEncrypted),
    tokenExpiresAt: account.tokenExpiresAt,
    scopes: account.scopes,
    metadata: (account.metadata as Record<string, unknown>) ?? {},
  };
}

/** Refresh margin: a token about to expire mid-publish is refreshed first. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Hands back an account with a token that is good right now, refreshing it in
 * place if the network supports that. Throws a PlatformError with a reconnect
 * message when the user has to intervene.
 */
export async function getUsableAccount(accountId: string): Promise<{
  row: SocialAccount;
  account: DecryptedAccount;
}> {
  const row = await db.socialAccount.findUnique({ where: { id: accountId } });
  if (!row) throw new Error(`Social account ${accountId} no longer exists`);

  let account = decryptAccount(row);
  const adapter = getAdapterForAccount(row);

  const expiringSoon =
    account.tokenExpiresAt != null && account.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;

  if (expiringSoon) {
    const refreshed = await adapter.refreshToken(account).catch((error) => {
      console.error(`[social] refresh failed for ${row.platform} ${row.id}`, error);
      return null;
    });

    if (refreshed) {
      const updated = await db.socialAccount.update({
        where: { id: row.id },
        data: {
          accessTokenEncrypted: encryptOptional(refreshed.accessToken),
          refreshTokenEncrypted: encryptOptional(refreshed.refreshToken ?? account.refreshToken),
          tokenExpiresAt: refreshed.expiresAt ?? null,
          status: SocialAccountStatus.ACTIVE,
          statusMessage: null,
        },
      });
      account = decryptAccount(updated);
      return { row: updated, account };
    }

    await markExpired(row);
    throw new PlatformError({
      platform: row.platform,
      code: 'AUTH',
      needsReconnect: true,
      message: `${row.accountName} authorization expired. Reconnect it to continue publishing.`,
    });
  }

  return { row, account };
}

/** Flags the channel and tells the workspace's admins why publishing stopped. */
export async function markExpired(account: SocialAccount, message?: string): Promise<void> {
  await db.socialAccount.update({
    where: { id: account.id },
    data: {
      status: SocialAccountStatus.EXPIRED,
      statusMessage:
        message ?? `Authorization expired. Reconnect ${account.accountName} to continue publishing.`,
    },
  });

  const [admins, workspace] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId: account.workspaceId, role: { in: ['OWNER', 'ADMIN'] } },
      select: { userId: true },
    }),
    db.workspace.findUniqueOrThrow({
      where: { id: account.workspaceId },
      select: { slug: true },
    }),
  ]);

  await notify({
    workspaceId: account.workspaceId,
    userIds: admins.map((a) => a.userId),
    type: 'OAUTH_EXPIRED',
    title: `${account.accountName} needs reconnecting`,
    body: `${account.accountName} authorization expired. Scheduled posts on this channel will fail until it is reconnected.`,
    href: `/w/${workspace.slug}/channels`,
  });
}

/** Re-checks every channel in a workspace and updates its status line. */
export async function refreshAccountStatuses(workspaceId: string): Promise<void> {
  const accounts = await db.socialAccount.findMany({
    where: { workspaceId, status: { not: SocialAccountStatus.DISCONNECTED } },
  });

  await Promise.all(
    accounts.map(async (row) => {
      const adapter = getAdapterForAccount(row);
      try {
        const result = await adapter.validateAccount(decryptAccount(row));
        await db.socialAccount.update({
          where: { id: row.id },
          data: {
            status: result.valid
              ? SocialAccountStatus.ACTIVE
              : result.needsReconnect
                ? SocialAccountStatus.EXPIRED
                : SocialAccountStatus.ERROR,
            statusMessage: result.valid ? null : (result.message ?? null),
            lastSyncedAt: new Date(),
          },
        });
      } catch (error) {
        console.error(`[social] status check failed for ${row.id}`, error);
        await db.socialAccount.update({
          where: { id: row.id },
          data: {
            status: SocialAccountStatus.ERROR,
            statusMessage:
              error instanceof PlatformError
                ? error.message
                : 'Bridge88 could not reach this channel. It will try again.',
            lastSyncedAt: new Date(),
          },
        });
      }
    }),
  );
}

/** Creates the demo channels used by development mode and the seed script. */
export async function createDemoAccount(input: {
  workspaceId: string;
  platform: Platform;
  accountName: string;
  handle?: string;
  simulate?: 'flaky' | 'expired' | 'rejected';
}): Promise<SocialAccount> {
  const externalAccountId = `demo-${input.platform.toLowerCase()}-${Math.random().toString(36).slice(2, 10)}`;
  return db.socialAccount.create({
    data: {
      workspaceId: input.workspaceId,
      platform: input.platform,
      accountName: input.accountName,
      accountHandle: input.handle ?? `@${input.accountName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      externalAccountId,
      accessTokenEncrypted: encryptOptional(`demo-token-${externalAccountId}`),
      tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      scopes: ['read', 'publish', 'analytics'],
      status: input.simulate === 'expired' ? SocialAccountStatus.EXPIRED : SocialAccountStatus.ACTIVE,
      statusMessage:
        input.simulate === 'expired'
          ? `Authorization expired. Reconnect ${input.accountName} to continue publishing.`
          : null,
      lastSyncedAt: new Date(),
      metadata: {
        mock: true,
        handle: input.handle,
        ...(input.simulate ? { simulate: input.simulate } : {}),
      },
    },
  });
}
