import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/env', () => ({ env: { RESEND_API_KEY: '' } }));
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn() }));

import {
  normalizeNotificationHref,
  notificationDestination,
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
