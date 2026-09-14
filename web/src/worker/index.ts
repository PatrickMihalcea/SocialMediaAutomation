import { enqueue, queue } from '@/lib/queue';
import { scanDuePosts } from '@/lib/publishing/engine';
import { expandAllRecurrences } from '@/lib/scheduling/recurrence';
import { scanDueWorkflows } from '@/lib/workflows/schedule';
import { sweepWorkflowRuns } from '@/lib/workflows/engine';
import { db } from '@/lib/db';

async function enqueueAnalyticsSyncs() {
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  await Promise.all(workspaces.map(({ id }) => enqueue(
    'sync-workspace-analytics',
    { workspaceId: id },
    { workspaceId: id, dedupeKey: `workspace-analytics:${id}` },
  )));
}

async function main() {
  await queue().start();
  await scanDuePosts();
  const publishTimer = setInterval(() => void scanDuePosts(), 15_000);
  const recurrenceTimer = setInterval(() => void expandAllRecurrences(), 24 * 60 * 60 * 1000);
  const analyticsTimer = setInterval(() => void enqueueAnalyticsSyncs(), 6 * 60 * 60 * 1000);
  const workflowTimer = setInterval(() => void scanDueWorkflows(), 30_000);
  // Reclaims steps whose worker died mid-run, and settles runs whose last step
  // finished between its status write and the run being marked done.
  const workflowSweepTimer = setInterval(() => void sweepWorkflowRuns(), 60_000);
  // Announce the drivers in force. A worker silently falling back to a mock
  // provider or a missing encoder is otherwise only discovered when a run fails.
  const { env } = await import('@/lib/env');
  const { renderer } = await import('@/lib/render');
  const { audioAnalyzer } = await import('@/lib/audio');
  console.log(
    `[worker] started with queue=${queue().name} storage=${env.STORAGE_DRIVER} ai=${env.AI_PROVIDER} ` +
      `render=${renderer().name}(${(await renderer().isAvailable()) ? 'ready' : 'unavailable'}) ` +
      `audio=${audioAnalyzer().name}(${(await audioAnalyzer().isAvailable()) ? 'ready' : 'unavailable'})`,
  );

  const stop = async () => {
    clearInterval(publishTimer);
    clearInterval(recurrenceTimer);
    clearInterval(analyticsTimer);
    clearInterval(workflowTimer);
    clearInterval(workflowSweepTimer);
    await queue().stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error('[worker] failed to start', error);
  process.exit(1);
});
