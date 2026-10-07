import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { runJob } from '@/lib/queue/runner';
import { scanDueWorkflows } from '@/lib/workflows/schedule';
import { isWakeConfigured, wakeWorkerIfIdle } from '@/lib/queue/wake-remote-worker';
import { reclaimStaleJobs } from '@/lib/queue/store';
import { sweepWorkflowRuns } from '@/lib/workflows/engine';

/**
 * Vercel Cron entry point for workflows. Long-running deployments use the
 * worker instead, which polls on a much shorter interval.
 *
 * Note the limit this implies: on a cron-only deployment a step can only run for
 * as long as the serverless function is allowed to. Video rendering needs the
 * worker (`npm run worker:prod`).
 */
export async function GET(request: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: 'Cron is not configured.' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // The clock, and only the clock.
  //
  // Both are queries: they read what is due, start it, and return. Starting a
  // run enqueues its first step, and enqueueing wakes the remote worker, so
  // the work begins on a machine built for it within seconds of this call.
  const started = await scanDueWorkflows();
  const swept = await sweepWorkflowRuns();
  // A worker that died mid-job leaves its rows RUNNING with nobody behind
  // them. The worker reclaims these at the start of a pass — which is no help
  // at all when the reason nothing is happening is that no pass is starting.
  const reclaimed = await reclaimStaleJobs();

  // The one check nothing else makes: work is waiting and no worker is up.
  //
  // Enqueueing wakes a worker, but that is a single fire-and-forget call. Lose
  // it — a cancelled pass, a deploy mid-flight, a rejected token — and the job
  // waits for GitHub's five-minute schedule, which has in practice gone over an
  // hour between ticks. Asking here turns a permanent stall into a one-minute
  // delay, because recovery no longer depends on any single call succeeding.
  const woke = await wakeWorkerIfIdle(await queuedJobCount());

  // Draining the queue here is a last resort, not the normal path.
  //
  // A step renders video or waits minutes on an image. This is a serverless
  // request measured in seconds, and whatever it starts is killed part-way —
  // leaving jobs RUNNING with nobody behind them, which is the exact state the
  // worker's reclaim exists to repair. It also held the request long past any
  // caller's patience: a one-minute cron ticking against it timed out on every
  // call, so a dashboard full of failures hid the real ones.
  //
  // So it runs only where nothing else will: a deployment with no remote
  // worker configured has no other way to make progress, and a slow request is
  // better than none. Where the worker is configured, it has already been
  // woken above and this would only take work away from it.
  const drained = env.QUEUE_DRIVER === 'in-process' && !isWakeConfigured()
    ? await drainAFew()
    : 0;

  return NextResponse.json({ ...started, ...swept, reclaimed, woke, drained });
}

/** Work that is due and has nobody doing it. */
async function queuedJobCount(): Promise<number> {
  return db.job.count({
    where: { queue: 'WORKFLOW', status: 'QUEUED', runAt: { lte: new Date() } },
  });
}

/**
 * A few jobs, for a deployment that has no worker of its own.
 *
 * Deliberately small. Nothing here can finish a video render inside a
 * serverless request, and the aim is only that such a deployment creeps
 * forward on each tick rather than standing still.
 */
async function drainAFew(): Promise<number> {
  const jobs = await db.job.findMany({
    where: { queue: 'WORKFLOW', status: 'QUEUED', runAt: { lte: new Date() } },
    orderBy: { runAt: 'asc' },
    take: 3,
    select: { id: true },
  });
  await Promise.all(jobs.map((job) => runJob(job.id)));
  return jobs.length;
}
