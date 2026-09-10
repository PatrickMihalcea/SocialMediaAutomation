import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Plan } from '@prisma/client';

const dbMock = vi.hoisted(() => ({
  subscription: { findUnique: vi.fn() },
  usageRecord: { findUnique: vi.fn(), upsert: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  arrivalLimitNotice,
  assertWithinLimit,
  firstQueryValue,
  formatBytes,
  GENERIC_LIMIT_ARRIVAL,
  limitMessage,
  nextMonthlyReset,
} from './limits';

describe('billing limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.subscription.findUnique.mockResolvedValue({ plan: Plan.FREE, status: 'ACTIVE' });
  });

  it('allows the value immediately below the boundary', async () => {
    await expect(assertWithinLimit('workspace-1', 'aiGenerations', 99)).resolves.toBeUndefined();
  });

  it('blocks at and above the boundary with usage, ceiling, reset, and next step', async () => {
    await expect(assertWithinLimit('workspace-1', 'aiGenerations', 100)).rejects.toMatchObject({
      code: 'LIMIT_REACHED',
      message: expect.stringMatching(/100 of 100.*resets on.*change plans in Billing/i),
    });
    await expect(assertWithinLimit('workspace-1', 'aiGenerations', 101)).rejects.toMatchObject({
      code: 'LIMIT_REACHED',
      message: expect.stringContaining('101 of 100'),
    });
  });

  it('explains that capacity limits have no automatic reset', () => {
    expect(limitMessage({
      plan: Plan.PRO,
      feature: 'socialAccounts',
      used: 10,
      limit: 10,
      now: new Date('2026-09-10T12:00:00Z'),
    })).toBe(
      'You are using 10 of 10 connected social accounts on the Pro plan. This capacity does not reset automatically. Disconnect an account or change plans in Billing.',
    );
  });

  it('uses the first UTC day of the next month for monthly resets', () => {
    expect(nextMonthlyReset(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('formats storage usage against a legible ceiling', () => {
    expect(formatBytes(247_257)).toBe('241.5 KB');
    expect(formatBytes(10 * 1024 ** 3)).toBe('10 GB');
  });

  it('rewrites the next step when the same message is shown on Billing', () => {
    const refusal = limitMessage({
      plan: Plan.PRO,
      feature: 'socialAccounts',
      used: 10,
      limit: 10,
    });
    expect(refusal).toBe(
      'You are using 10 of 10 connected social accounts on the Pro plan. This capacity does not reset automatically. Disconnect an account or change plans in Billing.',
    );
    expect(arrivalLimitNotice('limit-reached', refusal)).toBe(
      'You are using 10 of 10 connected social accounts on the Pro plan. This capacity does not reset automatically. Disconnect an account or choose a higher plan.',
    );
  });

  it('reads the first value when a query parameter is repeated', () => {
    const refusal = limitMessage({ plan: Plan.PRO, feature: 'socialAccounts', used: 10, limit: 10 });
    expect(arrivalLimitNotice(['limit-reached', 'limit-reached'], [refusal, 'second'])).toBe(
      'You are using 10 of 10 connected social accounts on the Pro plan. This capacity does not reset automatically. Disconnect an account or choose a higher plan.',
    );
    expect(arrivalLimitNotice(['limit-reached', 'updated'], undefined)).toBe(GENERIC_LIMIT_ARRIVAL);
    expect(arrivalLimitNotice(['updated', 'limit-reached'], undefined)).toBeNull();
    expect(firstQueryValue(['  spaced  ', 'ignored'])).toBe('spaced');
    expect(firstQueryValue([])).toBeNull();
    expect(firstQueryValue(['', 'limit-reached'])).toBeNull();
  });

  it('never renders a hostile or unknown reason value', () => {
    expect(arrivalLimitNotice('limit-reached', '<script>alert(1)</script>')).toBe(GENERIC_LIMIT_ARRIVAL);
    expect(arrivalLimitNotice(undefined, 'LIMIT_REACHED')).toBe(GENERIC_LIMIT_ARRIVAL);
    expect(arrivalLimitNotice(undefined, 'javascript:alert(1)')).toBe(GENERIC_LIMIT_ARRIVAL);
    expect(arrivalLimitNotice(undefined, 'You are using 10 of 10 connected social accounts on the Pro plan. <img src=x onerror=alert(1)>')).toBe(GENERIC_LIMIT_ARRIVAL);
    expect(arrivalLimitNotice(undefined, ['<script>', 'also hostile'])).toBe(GENERIC_LIMIT_ARRIVAL);
    expect(arrivalLimitNotice(undefined, { toString: () => 'hack' })).toBeNull();
    expect(arrivalLimitNotice('limit-reached', undefined)).toBe(GENERIC_LIMIT_ARRIVAL);
    expect(arrivalLimitNotice('updated', undefined)).toBeNull();
  });
});
