import { enqueue, queue } from '@/lib/queue';
import { scanDuePosts } from '@/lib/publishing/engine';
import { expandAllRecurrences } from '@/lib/scheduling/recurrence';
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
  console.log(`[worker] started with ${queue().name}`);

  const stop = async () => {
    clearInterval(publishTimer);
    clearInterval(recurrenceTimer);
    clearInterval(analyticsTimer);
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
