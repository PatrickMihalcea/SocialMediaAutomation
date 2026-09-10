import 'server-only';
import { randomBytes } from 'node:crypto';
import { Platform, SocialAccountStatus, type Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { decryptOptional, decryptToken, encryptOptional, encryptToken, hashSecret } from '@/lib/crypto/tokens';
import { publicEnv } from '@/lib/env';
import type { ConnectionResult } from '@/lib/social/types';

const FLOW_TTL_MS = 10 * 60 * 1000;
const SELECTION_TTL_MS = 10 * 60 * 1000;

export const OAUTH_PLATFORMS = new Set<Platform>([
  Platform.INSTAGRAM,
  Platform.FACEBOOK,
  Platform.LINKEDIN,
  Platform.X,
  Platform.TIKTOK,
  Platform.YOUTUBE,
]);

export function parseOAuthPlatform(value: string): Platform | null {
  const platform = value.toUpperCase() as Platform;
  return OAUTH_PLATFORMS.has(platform) ? platform : null;
}

export function oauthRedirectUri(platform: Platform): string {
  const origin = new URL(publicEnv.appUrl);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('NEXT_PUBLIC_APP_URL must be an origin without a path, query, or credentials.');
  }
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) {
    throw new Error('NEXT_PUBLIC_APP_URL must use HTTPS outside local development.');
  }
  return new URL(`/api/oauth/${platform.toLowerCase()}/callback`, origin).toString();
}

export function issueOpaqueSecret(): string {
  return randomBytes(32).toString('base64url');
}

export async function createOAuthAttempt(input: {
  state: string;
  userId: string;
  workspaceId: string;
  platform: Platform;
  redirectUri: string;
  codeVerifier?: string;
  reconnectAccountId?: string;
}) {
  return db.oAuthAttempt.create({
    data: {
      stateHash: hashSecret(input.state),
      userId: input.userId,
      workspaceId: input.workspaceId,
      platform: input.platform,
      redirectUri: input.redirectUri,
      codeVerifierEncrypted: encryptOptional(input.codeVerifier),
      reconnectAccountId: input.reconnectAccountId,
      expiresAt: new Date(Date.now() + FLOW_TTL_MS),
    },
  });
}

/** Atomically consumes state before any token exchange, preventing callback replay. */
export async function consumeOAuthAttempt(state: string) {
  const stateHash = hashSecret(state);
  return db.$transaction(async (tx) => {
    const attempt = await tx.oAuthAttempt.findUnique({ where: { stateHash } });
    if (!attempt || attempt.expiresAt <= new Date() || attempt.consumedAt) return null;
    const consumed = await tx.oAuthAttempt.updateMany({
      where: { id: attempt.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) return null;
    return {
      ...attempt,
      codeVerifier: decryptOptional(attempt.codeVerifierEncrypted),
      codeVerifierEncrypted: undefined,
    };
  });
}

type SerializedConnectionResult = Omit<ConnectionResult, 'expiresAt'> & { expiresAt?: string };

function serializeResults(results: ConnectionResult[]): string {
  return JSON.stringify(results.map((result) => ({
    ...result,
    expiresAt: result.expiresAt?.toISOString(),
  } satisfies SerializedConnectionResult)));
}

function deserializeResults(value: string): ConnectionResult[] {
  const parsed = JSON.parse(value) as SerializedConnectionResult[];
  return parsed.map((result) => ({ ...result, expiresAt: result.expiresAt ? new Date(result.expiresAt) : undefined }));
}

export async function createOAuthSelection(input: {
  userId: string;
  workspaceId: string;
  platform: Platform;
  results: ConnectionResult[];
  reconnectAccountId?: string | null;
}) {
  const secret = issueOpaqueSecret();
  await db.oAuthSelection.create({
    data: {
      secretHash: hashSecret(secret),
      userId: input.userId,
      workspaceId: input.workspaceId,
      platform: input.platform,
      resultsEncrypted: encryptToken(serializeResults(input.results)),
      reconnectAccountId: input.reconnectAccountId,
      expiresAt: new Date(Date.now() + SELECTION_TTL_MS),
    },
  });
  return secret;
}

export async function readOAuthSelection(secret: string, userId: string) {
  const row = await db.oAuthSelection.findUnique({ where: { secretHash: hashSecret(secret) } });
  if (!row || row.userId !== userId || row.consumedAt || row.expiresAt <= new Date()) return null;
  return { ...row, results: deserializeResults(decryptToken(row.resultsEncrypted)), resultsEncrypted: undefined };
}

export async function consumeOAuthSelection(secret: string, userId: string, externalIds: string[]) {
  const uniqueIds = [...new Set(externalIds)];
  return db.$transaction(async (tx) => {
    const row = await tx.oAuthSelection.findUnique({ where: { secretHash: hashSecret(secret) } });
    if (!row || row.userId !== userId || row.consumedAt || row.expiresAt <= new Date()) return null;
    const results = deserializeResults(decryptToken(row.resultsEncrypted));
    const chosen = results.filter((result) => uniqueIds.includes(result.externalAccountId));
    if (!chosen.length || chosen.length !== uniqueIds.length) return null;
    const consumed = await tx.oAuthSelection.updateMany({
      where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date(), resultsEncrypted: encryptToken('[]') },
    });
    if (consumed.count !== 1) return null;
    return { row, results: chosen };
  });
}

export async function persistConnections(input: {
  workspaceId: string;
  platform: Platform;
  results: ConnectionResult[];
  reconnectAccountId?: string | null;
}) {
  return db.$transaction(async (tx) => {
    const saved = [];
    for (const result of input.results) {
      saved.push(await tx.socialAccount.upsert({
        where: {
          workspaceId_platform_externalAccountId: {
            workspaceId: input.workspaceId,
            platform: input.platform,
            externalAccountId: result.externalAccountId,
          },
        },
        create: connectionData(input.workspaceId, input.platform, result),
        update: {
          ...connectionData(input.workspaceId, input.platform, result),
          workspaceId: undefined,
          platform: undefined,
          externalAccountId: undefined,
        },
      }));
    }
    if (input.reconnectAccountId && !saved.some((account) => account.id === input.reconnectAccountId)) {
      await tx.socialAccount.updateMany({
        where: { id: input.reconnectAccountId, workspaceId: input.workspaceId, platform: input.platform },
        data: {
          status: SocialAccountStatus.DISCONNECTED,
          accessTokenEncrypted: null,
          refreshTokenEncrypted: null,
          statusMessage: 'Replaced by a newly authorized account.',
        },
      });
    }
    return saved;
  });
}

function connectionData(workspaceId: string, platform: Platform, result: ConnectionResult) {
  return {
    workspaceId,
    platform,
    externalAccountId: result.externalAccountId,
    accountName: result.accountName,
    accountHandle: result.accountHandle ?? null,
    avatarUrl: result.avatarUrl ?? null,
    accessTokenEncrypted: encryptToken(result.accessToken),
    refreshTokenEncrypted: encryptOptional(result.refreshToken),
    tokenExpiresAt: result.expiresAt ?? null,
    scopes: result.scopes,
    metadata: (result.metadata ?? {}) as Prisma.InputJsonValue,
    status: SocialAccountStatus.ACTIVE,
    statusMessage: null,
    lastSyncedAt: new Date(),
  };
}
