import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { runJob } from '@/lib/queue/runner';
import { scanDueWorkflows } from '@/lib/workflows/schedule';
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

  const started = await scanDueWorkflows();
  const swept = await sweepWorkflowRuns();

  // The in-process driver has no background loop in a serverless request, so
  // the queued steps are drained here.
  if (env.QUEUE_DRIVER === 'in-process') {
    const jobs = await db.job.findMany({
      where: { queue: 'WORKFLOW', status: 'QUEUED', runAt: { lte: new Date() } },
      orderBy: { runAt: 'asc' },
      take: 10,
      select: { id: true },
    });
    await Promise.all(jobs.map((job) => runJob(job.id)));
  }

  return NextResponse.json({ ...started, ...swept });
}
