import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from '@prisma/client';
import { decryptToken } from '@/lib/crypto/tokens';

const mock = vi.hoisted(() => {
  let attempt: Record<string, unknown> | null = null;
  const tx = {
    oAuthAttempt: {
      findUnique: vi.fn(async () => attempt),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (!attempt || attempt.consumedAt) return { count: 0 };
        attempt = { ...attempt, ...data };
        return { count: 1 };
      }),
    },
    socialAccount: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'saved-id', ...create })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return {
    tx,
    db: {
      oAuthAttempt: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          attempt = { id: 'attempt-id', consumedAt: null, createdAt: new Date(), ...data };
          return attempt;
        }),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
    reset() {
      attempt = null;
      vi.clearAllMocks();
    },
    getAttempt: () => attempt,
  };
});

vi.mock('@/lib/db', () => ({ db: mock.db }));

import {
  consumeOAuthAttempt,
  createOAuthAttempt,
  issueOpaqueSecret,
  parseOAuthPlatform,
  persistConnections,
} from '@/lib/social/oauth';

describe('OAuth state and token persistence', () => {
  beforeEach(() => mock.reset());

  it('stores only hashed state and encrypted PKCE, then consumes it once', async () => {
    const state = issueOpaqueSecret();
    await createOAuthAttempt({
      state,
      userId: 'user-id',
      workspaceId: 'workspace-id',
      platform: Platform.X,
      redirectUri: 'https://app.example/api/oauth/x/callback',
      codeVerifier: 'pkce-secret',
    });

    const stored = mock.getAttempt()!;
    expect(stored.stateHash).not.toBe(state);
    expect(String(stored.codeVerifierEncrypted)).not.toContain('pkce-secret');

    const first = await consumeOAuthAttempt(state);
    expect(first?.codeVerifier).toBe('pkce-secret');
    await expect(consumeOAuthAttempt(state)).resolves.toBeNull();
  });

  it('encrypts access and refresh tokens before an upsert', async () => {
    await persistConnections({
      workspaceId: 'workspace-id',
      platform: Platform.X,
      results: [{
        externalAccountId: 'external-id',
        accountName: 'Account',
        accessToken: 'access-secret',
        refreshToken: 'refresh-secret',
        scopes: ['tweet.write'],
      }],
    });

    const create = mock.tx.socialAccount.upsert.mock.calls[0][0].create;
    expect(create.accessTokenEncrypted).not.toContain('access-secret');
    expect(decryptToken(String(create.accessTokenEncrypted))).toBe('access-secret');
    expect(decryptToken(String(create.refreshTokenEncrypted))).toBe('refresh-secret');
  });

  it('rejects unsupported platform path values', () => {
    expect(parseOAuthPlatform('youtube')).toBe(Platform.YOUTUBE);
    expect(parseOAuthPlatform('mock')).toBeNull();
    expect(parseOAuthPlatform('../x')).toBeNull();
  });
});
