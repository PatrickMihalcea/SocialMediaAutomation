import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  notificationCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: mocks.userFindMany },
    notification: { create: mocks.notificationCreate },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/env', () => ({ env: { RESEND_API_KEY: '' } }));
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn() }));

import {
  normalizeNotificationHref,
  notificationDestination,
  notify,
} from '@/lib/notifications/service';

describe('approval notification destinations', () => {
  it('turns legacy calendar approval links into direct post links', () => {
    expect(normalizeNotificationHref(
      'APPROVAL_REQUESTED',
      '/w/northwind-studio/calendar?post=post-123',
    )).toBe('/w/northwind-studio/posts/post-123');

    expect(normalizeNotificationHref(
      'APPROVAL_COMPLETED',
      '/w/northwind-studio/calendar?view=month&post=post%2F123',
    )).toBe('/w/northwind-studio/posts/post%2F123');
  });

  it('keeps unrelated notification destinations unchanged', () => {
    expect(normalizeNotificationHref(
      'POST_PUBLISHED',
      '/w/northwind-studio/calendar?post=post-123',
    )).toBe('/w/northwind-studio/calendar?post=post-123');
  });

  it('normalizes workspace-id links and uses safe approval fallbacks', () => {
    expect(notificationDestination(
      'APPROVAL_REQUESTED',
      '/w/workspace-id/calendar?post=post-123',
      'northwind-studio',
      'workspace-id',
    )).toBe('/w/northwind-studio/posts/post-123');

    expect(notificationDestination(
      'APPROVAL_REQUESTED',
      null,
      'northwind-studio',
      'workspace-id',
    )).toBe('/w/northwind-studio/team');
  });
});

describe('notification category preferences', () => {
  const recipient = (id: string, overrides: Record<string, boolean> = {}) => ({
    id,
    notificationEmailEnabled: false,
    notificationInAppEnabled: true,
    notificationApprovalsEnabled: true,
    notificationPublishingFailuresEnabled: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationCreate.mockImplementation(({ data }) => Promise.resolve({ ...data, id: `n-${data.userId}` }));
    mocks.transaction.mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations));
  });

  it('suppresses an approval notification only for members who turned that category off', async () => {
    mocks.userFindMany.mockResolvedValue([
      recipient('wants-approvals'),
      recipient('muted-approvals', { notificationApprovalsEnabled: false }),
    ]);

    await notify({
      workspaceId: 'workspace-1',
      userIds: ['wants-approvals', 'muted-approvals'],
      type: 'APPROVAL_REQUESTED',
      title: 'A post needs review',
    });

    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1);
    expect(mocks.notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'wants-approvals' }) }),
    );
  });

  it('suppresses a publishing failure for a member who turned failures off', async () => {
    mocks.userFindMany.mockResolvedValue([
      recipient('muted-failures', { notificationPublishingFailuresEnabled: false }),
    ]);

    await notify({
      workspaceId: 'workspace-1',
      userIds: ['muted-failures'],
      type: 'POST_FAILED',
      title: 'Publishing failed',
    });

    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it('writes no inbox row when in-app delivery is off', async () => {
    mocks.userFindMany.mockResolvedValue([
      recipient('no-inbox', { notificationInAppEnabled: false }),
    ]);

    await notify({
      workspaceId: 'workspace-1',
      userIds: ['no-inbox'],
      type: 'AI_GENERATION_COMPLETE',
      title: 'AI media is ready',
    });

    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });
});
