import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/queue';

export async function GET(request: Request) {
  if (!env.CRON_SECRET) return NextResponse.json({ error: 'Cron is not configured.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  await Promise.all(workspaces.map(({ id }) => enqueue(
    'sync-workspace-analytics',
    { workspaceId: id },
    { workspaceId: id, dedupeKey: `workspace-analytics:${id}` },
  )));
  return NextResponse.json({ queued: workspaces.length });
}
