import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      database: 'available',
      uptimeSeconds: Math.floor(process.uptime()),
      responseMs: Date.now() - startedAt,
    });
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'unavailable' }, { status: 503 });
  }
}
