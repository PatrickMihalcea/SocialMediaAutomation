import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workflowFindMany: vi.fn(),
  workflowUpdate: vi.fn(),
  workflowUpdateMany: vi.fn(),
  startWorkflowRun: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  db: {
    workflow: {
      findMany: mocks.workflowFindMany,
      update: mocks.workflowUpdate,
      updateMany: mocks.workflowUpdateMany,
    },
    $transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
  },
}));
vi.mock('@/lib/workflows/engine', () => ({ startWorkflowRun: mocks.startWorkflowRun }));

import { computeNextRun, retimeWorkflows, scanDueWorkflows } from '@/lib/workflows/schedule';

const MONDAY = new Date('2026-09-14T00:00:00Z');

describe('computeNextRun', () => {
  it('resolves the weekly slot as a wall-clock time in the given zone', () => {
    const next = computeNextRun(
      {
        scheduleEnabled: true,
        scheduleWeekdays: [1],
        scheduleHour: 9,
        scheduleMinute: 0,
        timezone: 'Europe/Bucharest',
      },
      MONDAY,
    );
    expect(next?.toISOString()).toBe('2026-09-14T06:00:00.000Z');
  });

  it('picks the earliest of several days', () => {
    const next = computeNextRun(
      {
        scheduleEnabled: true,
        scheduleWeekdays: [1, 4],
        scheduleHour: 9,
        scheduleMinute: 30,
        timezone: 'UTC',
      },
      MONDAY,
    );
    expect(next?.toISOString()).toBe('2026-09-14T09:30:00.000Z');
  });

  it('has no next run without a schedule', () => {
    const slot = { scheduleHour: 9, scheduleMinute: 0, timezone: 'UTC' };
    expect(computeNextRun({ ...slot, scheduleEnabled: false, scheduleWeekdays: [1] }, MONDAY)).toBeNull();
    expect(computeNextRun({ ...slot, scheduleEnabled: true, scheduleWeekdays: [] }, MONDAY)).toBeNull();
  });
});

describe('retimeWorkflows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('moves every workflow to the new zone and rebooks the slot it had already taken', async () => {
    mocks.workflowFindMany.mockResolvedValue([
      { id: 'scheduled', scheduleEnabled: true, scheduleWeekdays: [1], scheduleHour: 9, scheduleMinute: 0 },
      { id: 'manual', scheduleEnabled: false, scheduleWeekdays: [], scheduleHour: 9, scheduleMinute: 0 },
    ]);

    await expect(retimeWorkflows('workspace-1', 'Europe/Bucharest')).resolves.toBe(2);

    expect(mocks.workflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'workspace-1' } }),
    );
    const [scheduled, manual] = mocks.workflowUpdate.mock.calls.map(([call]) => call);
    expect(scheduled.where).toEqual({ id: 'scheduled' });
    expect(scheduled.data.timezone).toBe('Europe/Bucharest');
    // 09:00 in Bucharest, not the 09:00 UTC the old zone had booked.
    expect(scheduled.data.nextRunAt.getUTCHours()).toBe(6);
    expect(manual.data).toEqual({ timezone: 'Europe/Bucharest', nextRunAt: null });
  });

  it('writes nothing when the workspace has no workflows', async () => {
    mocks.workflowFindMany.mockResolvedValue([]);
    await expect(retimeWorkflows('workspace-1', 'UTC')).resolves.toBe(0);
    expect(mocks.workflowUpdate).not.toHaveBeenCalled();
  });
});

describe('scanDueWorkflows', () => {
  // The assertion below names an absolute instant, so the clock has to be
  // pinned: read live, this passes only when the suite happens to run before
  // 06:00 UTC on a Monday and fails every other hour of the week. Only Date is
  // faked, so awaited promises still resolve normally.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-14T05:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('rebooks the next slot in the workspace zone, not the row-level one', async () => {
    mocks.workflowFindMany.mockResolvedValue([
      {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
        scheduleEnabled: true,
        scheduleWeekdays: [1],
        scheduleHour: 9,
        scheduleMinute: 0,
        nextRunAt: new Date('2026-09-07T09:00:00Z'),
        // Stale: written before the workspace moved off UTC.
        timezone: 'UTC',
        workspace: { timezone: 'Europe/Bucharest' },
      },
    ]);
    mocks.workflowUpdateMany.mockResolvedValue({ count: 1 });

    await expect(scanDueWorkflows()).resolves.toEqual({ started: 1 });

    const [claim] = mocks.workflowUpdateMany.mock.calls[0];
    expect(claim.data.nextRunAt.toISOString()).toBe('2026-09-14T06:00:00.000Z');
    expect(mocks.startWorkflowRun).toHaveBeenCalledOnce();
  });
});
