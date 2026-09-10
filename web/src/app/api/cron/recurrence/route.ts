import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { expandAllRecurrences } from '@/lib/scheduling/recurrence';

export async function GET(request: Request) {
  if (!env.CRON_SECRET) return NextResponse.json({ error: 'Cron is not configured.' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const result = await expandAllRecurrences();
  return NextResponse.json({ expanded: result });
}
