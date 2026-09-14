import 'server-only';
import { WorkflowRunTrigger } from '@prisma/client';
import { db } from '@/lib/db';
import { nextOccurrence } from '@/lib/scheduling/time';
import { startWorkflowRun } from '@/lib/workflows/engine';

/**
 * Weekly scheduling, reusing the shape SchedulingRule already uses: weekday plus
 * wall-clock time in the workspace's zone, resolved to a UTC instant. A cron
 * expression would have meant shipping a parser for a feature nobody asked to
 * express in cron.
 */
export function computeNextRun(workflow: {
  scheduleEnabled: boolean;
  scheduleWeekdays: number[];
  scheduleHour: number;
  scheduleMinute: number;
  timezone: string;
}, from = new Date()): Date | null {
  if (!workflow.scheduleEnabled || workflow.scheduleWeekdays.length === 0) return null;

  const candidates = workflow.scheduleWeekdays.map((weekday) =>
    nextOccurrence(from, workflow.timezone, weekday, workflow.scheduleHour, workflow.scheduleMinute),
  );
  return candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
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
  });

  let started = 0;
  for (const workflow of due) {
    const next = computeNextRun(workflow);
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
      console.error('[workflow] scheduled run failed to start', workflow.id, error);
    }
  }
  return { started };
}
