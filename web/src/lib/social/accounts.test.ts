import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from '@prisma/client';

const dbMock = vi.hoisted(() => ({
  socialAccount: {
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
}));
const adapter = vi.hoisted(() => ({
  refreshToken: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/crypto/tokens', () => ({
  decryptOptional: vi.fn((value: string | null) => value),
  encryptOptional: vi.fn((value: string | null) => value),
}));
vi.mock('@/lib/social/registry', () => ({
  getAdapterForAccount: vi.fn(() => adapter),
}));
vi.mock('@/lib/notifications/service', () => ({ notify: vi.fn() }));

import { createDemoAccount, getUsableAccount } from '@/lib/social/accounts';

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-1',
    workspaceId: 'workspace-1',
    platform: 'LINKEDIN',
    externalAccountId: 'external-1',
    accountName: 'Bridge88 LinkedIn',
    accessTokenEncrypted: 'encrypted-token',
    refreshTokenEncrypted: null,
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    scopes: ['publish'],
    status: 'ACTIVE',
    metadata: {},
    ...overrides,
  };
}

describe('publishable social accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks an account after it has been disconnected', async () => {
    dbMock.socialAccount.findUnique.mockResolvedValue(account({
      status: 'DISCONNECTED',
      accessTokenEncrypted: null,
    }));

    await expect(getUsableAccount('account-1')).rejects.toMatchObject({
      code: 'DISCONNECTED',
      retryable: false,
      needsReconnect: false,
    });
    expect(adapter.refreshToken).not.toHaveBeenCalled();
  });

  it.each(['EXPIRED', 'REVOKED', 'ERROR'])('requires reconnection for %s accounts', async (status) => {
    dbMock.socialAccount.findUnique.mockResolvedValue(account({ status }));

    await expect(getUsableAccount('account-1')).rejects.toMatchObject({
      code: 'AUTH',
      retryable: false,
      needsReconnect: true,
    });
  });

  it('blocks an active account whose token is missing', async () => {
    dbMock.socialAccount.findUnique.mockResolvedValue(account({ accessTokenEncrypted: null }));

    await expect(getUsableAccount('account-1')).rejects.toMatchObject({
      code: 'AUTH',
      needsReconnect: true,
    });
  });

  it('uses one stable external identity for repeated demo connections', async () => {
    dbMock.socialAccount.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => create);

    await createDemoAccount({
      workspaceId: 'workspace-1',
      platform: Platform.INSTAGRAM,
      accountName: 'Studio Instagram',
      handle: '@studio',
    });
    await createDemoAccount({
      workspaceId: 'workspace-1',
      platform: Platform.INSTAGRAM,
      accountName: 'Studio Instagram',
      handle: '@studio',
    });

    const first = dbMock.socialAccount.upsert.mock.calls[0][0];
    const second = dbMock.socialAccount.upsert.mock.calls[1][0];
    expect(first.where.workspaceId_platform_externalAccountId).toEqual(
      second.where.workspaceId_platform_externalAccountId,
    );
    expect(first.create.externalAccountId).toBe('demo-workspace-1-instagram');
    expect(second.update.status).toBe('ACTIVE');
  });
});
