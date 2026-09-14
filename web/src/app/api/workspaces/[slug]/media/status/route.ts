import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { toAppError } from '@/lib/errors';

/**
 * Processing status for a set of assets.
 *
 * Uploads land as PROCESSING and are finished by a background job — thumbnail,
 * dimensions, duration, beat grid — long after the page was rendered. Without
 * this the library sat on "Processing" until someone reloaded by hand.
 *
 * Deliberately the narrowest possible payload. The client refreshes the RSC
 * tree when a status actually changes, and that is what brings the poster frame
 * and the metadata with it; polling never carries them itself.
 */
export const dynamic = 'force-dynamic';

/** One page of the grid is 12 assets; this is far above any realistic batch. */
const MAX_IDS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const ctx = await requireWorkspace(slug, 'media:view');

    // Filtered to well-formed uuids rather than passed through: the id column is
    // @db.Uuid, so one malformed value makes Postgres reject the whole query.
    const ids = (new URL(request.url).searchParams.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => UUID.test(id))
      .slice(0, MAX_IDS);
    if (!ids.length) {
      return NextResponse.json({ assets: [] }, { headers: { 'cache-control': 'no-store' } });
    }

    const assets = await db.mediaAsset.findMany({
      where: { id: { in: ids }, workspaceId: ctx.workspace.id },
      select: { id: true, status: true },
    });

    return NextResponse.json({ assets }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.detail) console.error('[api] media status', appError.detail);
    return NextResponse.json({ error: appError.message }, { status: appError.status });
  }
}
