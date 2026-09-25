import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workflowFindMany: vi.fn(),
  workflowUpdate: vi.fn(),
  workflowUpdateMany: vi.fn(),
  startWorkflowRun: vi.fn(),
  workflowFindUnique: vi.fn(),
  workflowRunCreate: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  db: {
    workflow: {
      findMany: mocks.workflowFindMany,
      findUnique: mocks.workflowFindUnique,
      update: mocks.workflowUpdate,
      updateMany: mocks.workflowUpdateMany,
    },
    workflowRun: { create: mocks.workflowRunCreate },
    $transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
  },
}));
vi.mock('@/lib/workflows/engine', () => ({ startWorkflowRun: mocks.startWorkflowRun }));

import {
  computeNextRun,
  hourMinuteOf,
  retimeWorkflows,
  scanDueWorkflows,
  scheduleTimesOf,
} from '@/lib/workflows/schedule';

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

  /**
   * The slot is claimed before the run is attempted, so a workflow that throws
   * on every start is not retried every tick. The cost is a spent slot, and
   * until this was recorded the only trace was a line in the scheduler's log —
   * which does not turn the job red and which nobody reads. From the app the
   * schedule had simply not fired.
   */
  it('records a run that could not start, with the reason', async () => {
    mocks.workflowFindMany.mockResolvedValue([
      {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
        scheduleEnabled: true,
        scheduleWeekdays: [1],
        scheduleTimes: [9 * 60],
        scheduleHour: 9,
        scheduleMinute: 0,
        nextRunAt: new Date('2026-09-07T09:00:00Z'),
        timezone: 'UTC',
        workspace: { timezone: 'UTC' },
      },
    ]);
    mocks.workflowUpdateMany.mockResolvedValue({ count: 1 });
    mocks.workflowFindUnique.mockResolvedValue({ nodes: [], edges: [] });
    mocks.startWorkflowRun.mockRejectedValueOnce(
      new Error('"Cut to the beat" needs something connected to its Media input.'),
    );

    await expect(scanDueWorkflows()).resolves.toEqual({ started: 0 });

    expect(mocks.workflowRunCreate).toHaveBeenCalledOnce();
    const [recorded] = mocks.workflowRunCreate.mock.calls[0];
    expect(recorded.data).toMatchObject({
      workflowId: 'workflow-1',
      trigger: 'SCHEDULE',
      status: 'FAILED',
      error: '"Cut to the beat" needs something connected to its Media input.',
    });
  });

  /** The next slot stays booked: recording the failure is not a retry. */
  it('still moves on to the next slot after a failed start', async () => {
    mocks.workflowFindMany.mockResolvedValue([
      {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
        scheduleEnabled: true,
        scheduleWeekdays: [1],
        scheduleTimes: [9 * 60],
        scheduleHour: 9,
        scheduleMinute: 0,
        nextRunAt: new Date('2026-09-07T09:00:00Z'),
        timezone: 'UTC',
        workspace: { timezone: 'UTC' },
      },
    ]);
    mocks.workflowUpdateMany.mockResolvedValue({ count: 1 });
    mocks.workflowFindUnique.mockResolvedValue({ nodes: [], edges: [] });
    mocks.startWorkflowRun.mockRejectedValueOnce(new Error('nope'));

    await scanDueWorkflows();

    const [claim] = mocks.workflowUpdateMany.mock.calls[0];
    expect(claim.data.nextRunAt.toISOString()).toBe('2026-09-14T09:00:00.000Z');
  });

  /** Recording is best effort: it must never skip the rest of the list. */
  it('carries on when the failure itself cannot be recorded', async () => {
    mocks.workflowFindMany.mockResolvedValue([
      {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
        scheduleEnabled: true,
        scheduleWeekdays: [1],
        scheduleTimes: [9 * 60],
        scheduleHour: 9,
        scheduleMinute: 0,
        nextRunAt: new Date('2026-09-07T09:00:00Z'),
        timezone: 'UTC',
        workspace: { timezone: 'UTC' },
      },
    ]);
    mocks.workflowUpdateMany.mockResolvedValue({ count: 1 });
    mocks.workflowFindUnique.mockRejectedValue(new Error('database gone'));
    mocks.startWorkflowRun.mockRejectedValueOnce(new Error('nope'));

    await expect(scanDueWorkflows()).resolves.toEqual({ started: 0 });
  });
});

describe('several times a day', () => {
  const base = {
    scheduleEnabled: true,
    scheduleWeekdays: [1],
    scheduleHour: 9,
    scheduleMinute: 0,
    timezone: 'Europe/Bucharest',
  };

  it('takes the soonest slot across every time on every day', () => {
    // Monday 09:00 and 18:30, asked at midnight UTC — which is 03:00 local.
    const next = computeNextRun({ ...base, scheduleTimes: [9 * 60, 18 * 60 + 30] }, MONDAY);

    expect(next?.toISOString()).toBe('2026-09-14T06:00:00.000Z');
  });

  it('moves to the later slot once the first has passed', () => {
    const afterMorning = new Date('2026-09-14T08:00:00Z'); // 11:00 in Bucharest

    const next = computeNextRun({ ...base, scheduleTimes: [9 * 60, 18 * 60 + 30] }, afterMorning);

    expect(next?.toISOString()).toBe('2026-09-14T15:30:00.000Z');
  });

  it('wraps to the first slot of the next chosen day after the last one', () => {
    const afterEvening = new Date('2026-09-14T16:00:00Z'); // 19:00 in Bucharest

    const next = computeNextRun(
      { ...base, scheduleWeekdays: [1, 3], scheduleTimes: [9 * 60, 18 * 60 + 30] },
      afterEvening,
    );

    expect(next?.toISOString()).toBe('2026-09-16T06:00:00.000Z');
  });

  /**
   * Every row written before times were a list has an empty column, and rows
   * are still written that way by anything setting only the pair. Falling back
   * is what keeps those firing at the time they say rather than at midnight.
   */
  it('falls back to the single hour and minute when no times are stored', () => {
    const next = computeNextRun({ ...base, scheduleTimes: [] }, MONDAY);

    expect(next?.toISOString()).toBe('2026-09-14T06:00:00.000Z');
  });

  it('ignores a repeated time rather than scheduling it twice', () => {
    expect(scheduleTimesOf({ scheduleTimes: [540, 540, 60], scheduleHour: 9, scheduleMinute: 0 }))
      .toEqual([60, 540]);
  });

  it('drops a time outside the day, which cannot be a wall-clock slot', () => {
    expect(scheduleTimesOf({ scheduleTimes: [1440, -1, 600], scheduleHour: 9, scheduleMinute: 0 }))
      .toEqual([600]);
  });

  it('reads minutes back as the pair a clock is written in', () => {
    expect(hourMinuteOf(18 * 60 + 30)).toEqual({ hour: 18, minute: 30 });
  });
});
