import 'server-only';
import { enqueue } from '@/lib/queue';
import { expandAllRecurrences } from '@/lib/scheduling/recurrence';
import { db } from '@/lib/db';

/**
 * The slow-cadence upkeep: recurrence expansion and analytics refresh.
 *
 * Split out of the always-on worker so the scheduled worker can run it too.
 * These are deliberately not part of the every-five-minutes pass — they are
 * safe to repeat, but calling them that often would hammer the platform APIs
 * far harder than intended — so they get their own, much slower schedule.
 */
export async function enqueueAnalyticsSyncs(): Promise<number> {
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  await Promise.all(workspaces.map(({ id }) => enqueue(
    'sync-workspace-analytics',
    { workspaceId: id },
    { workspaceId: id, dedupeKey: `workspace-analytics:${id}` },
  )));
  return workspaces.length;
}

export async function runCoarseUpkeep(): Promise<{ expanded: number; analytics: number }> {
  const expanded = await expandAllRecurrences();
  const analytics = await enqueueAnalyticsSyncs();
  return { expanded: typeof expanded === 'number' ? expanded : 0, analytics };
}
