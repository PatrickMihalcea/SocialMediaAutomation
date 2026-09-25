import 'server-only';
import { Prisma, WorkflowRunStatus, WorkflowRunTrigger } from '@prisma/client';
import { db } from '@/lib/db';
import {
  hourMinuteOf,
  nextOccurrence,
  scheduleTimesOf,
} from '@/lib/scheduling/time';
import { startWorkflowRun } from '@/lib/workflows/engine';
import { buildSnapshot } from '@/lib/workflows/snapshot';

export { hourMinuteOf, MAX_SCHEDULE_TIMES, scheduleTimesOf } from '@/lib/scheduling/time';

/** A schedule as it is stored, whichever columns a given row has filled in. */
export interface StoredSchedule {
  scheduleEnabled: boolean;
  scheduleWeekdays: number[];
  scheduleTimes?: number[];
  scheduleHour: number;
  scheduleMinute: number;
  timezone: string;
}

/**
 * Weekly scheduling, reusing the shape SchedulingRule already uses: weekday plus
 * wall-clock time in the workspace's zone, resolved to a UTC instant. A cron
 * expression would have meant shipping a parser for a feature nobody asked to
 * express in cron.
 *
 * Every chosen time on every chosen day is a candidate, and the soonest wins.
 * Two slots on one day is the common case — something posted in the morning and
 * again in the evening — and it used to take two copies of the same workflow.
 */
export function computeNextRun(workflow: StoredSchedule, from = new Date()): Date | null {
  if (!workflow.scheduleEnabled || workflow.scheduleWeekdays.length === 0) return null;

  const times = scheduleTimesOf(workflow);
  if (times.length === 0) return null;

  const candidates = workflow.scheduleWeekdays.flatMap((weekday) =>
    times.map((minutes) => {
      const { hour, minute } = hourMinuteOf(minutes);
      return nextOccurrence(from, workflow.timezone, weekday, hour, minute);
    }),
  );
  return candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

/**
 * Realigns every workflow in a workspace after its timezone changes.
 *
 * `nextRunAt` is a UTC instant derived from a wall-clock slot, so rewriting the
 * zone alone would leave the already-booked slot firing at the old local time.
 */
export async function retimeWorkflows(workspaceId: string, timezone: string): Promise<number> {
  const workflows = await db.workflow.findMany({
    where: { workspaceId },
    select: {
      id: true,
      scheduleEnabled: true,
      scheduleWeekdays: true,
      scheduleTimes: true,
      scheduleHour: true,
      scheduleMinute: true,
    },
  });
  if (workflows.length === 0) return 0;

  await db.$transaction(
    workflows.map((workflow) =>
      db.workflow.update({
        where: { id: workflow.id },
        data: { timezone, nextRunAt: computeNextRun({ ...workflow, timezone }) },
      }),
    ),
  );
  return workflows.length;
}

/**
 * Starts every workflow whose slot has arrived.
 *
 * `nextRunAt` is advanced before the run is started, so a run that throws does
 * not leave the workflow stuck re-firing the same slot on every tick.
 */
export async function scanDueWorkflows(): Promise<{ started: number }> {
  const due = await db.workflow.findMany({
    where: {
      enabled: true,
      archivedAt: null,
      scheduleEnabled: true,
      nextRunAt: { lte: new Date() },
    },
    take: 50,
    // The workspace owns the zone. Reading it here rather than trusting the
    // workflow's mirrored column keeps a row written before a zone change from
    // firing at the old wall-clock time.
    include: { workspace: { select: { timezone: true } } },
  });

  let started = 0;
  for (const workflow of due) {
    const next = computeNextRun({ ...workflow, timezone: workflow.workspace.timezone });
    const claimed = await db.workflow.updateMany({
      // Conditional on the slot we read, so two workers cannot both claim it.
      where: { id: workflow.id, nextRunAt: workflow.nextRunAt },
      data: { nextRunAt: next },
    });
    if (claimed.count === 0) continue;

    try {
      await startWorkflowRun({
        workflowId: workflow.id,
        workspaceId: workflow.workspaceId,
        trigger: WorkflowRunTrigger.SCHEDULE,
      });
      started += 1;
    } catch (error) {
      // A workflow that cannot start — an unconnected required input, say —
      // must not stop the others, and must not retry every fifteen seconds.
      // The slot above is already spent, so without a record of this the run
      // simply never happened and nothing anywhere said why.
      console.error('[workflow] scheduled run failed to start', workflow.id, error);
      await recordFailedStart(workflow, error);
    }
  }
  return { started };
}

/**
 * Writes down a scheduled run that never got off the ground.
 *
 * The slot is claimed before the run is attempted, deliberately: a workflow
 * that throws on every start must not be retried every fifteen seconds. The
 * cost of that is a spent slot with nothing to show for it, and until this
 * existed the only trace was a line in the scheduler's own log — which nobody
 * reads, and which does not turn the job red. From inside the app the schedule
 * had simply not fired, with the next run cheerfully booked for next week.
 *
 * So the failure is recorded as a run, with the reason on it. One row, and the
 * answer lands on the page people already open to ask the question.
 */
async function recordFailedStart(
  workflow: { id: string; workspaceId: string },
  error: unknown,
): Promise<void> {
  const message = error instanceof Error
    ? error.message
    : 'This scheduled run could not be started.';
  try {
    // The graph as it stands, so the recorded run shows the steps that could
    // not start rather than an empty canvas.
    const live = await db.workflow.findUnique({
      where: { id: workflow.id },
      select: { nodes: true, edges: true },
    });
    const at = new Date();
    await db.workflowRun.create({
      data: {
        workspaceId: workflow.workspaceId,
        workflowId: workflow.id,
        trigger: WorkflowRunTrigger.SCHEDULE,
        status: WorkflowRunStatus.FAILED,
        graph: (live
          ? buildSnapshot(live.nodes, live.edges)
          : { nodes: [], edges: [] }) as unknown as Prisma.InputJsonValue,
        error: message,
        startedAt: at,
        finishedAt: at,
        durationMs: 0,
      },
    });
  } catch (cause) {
    // Never the reason the next workflow in the list is skipped.
    console.error('[workflow] could not record the failed start', workflow.id, cause);
  }
}
