import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { scanDuePosts } from '@/lib/publishing/engine';
import { db } from '@/lib/db';
import { runJob } from '@/lib/queue/runner';

/** Vercel Cron entry point. Long-running deployments may use the worker instead. */
export async function GET(request: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: 'Cron is not configured.' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const result = await scanDuePosts();
  if (env.QUEUE_DRIVER === 'in-process') {
    const jobs = await db.job.findMany({
      where: { queue: 'POST_PUBLISHING', status: 'QUEUED', runAt: { lte: new Date() } },
      orderBy: { runAt: 'asc' },
      take: 20,
      select: { id: true },
    });
    await Promise.all(jobs.map((job) => runJob(job.id)));
  }
  return NextResponse.json(result);
}
