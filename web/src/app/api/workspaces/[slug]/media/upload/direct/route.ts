import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { toAppError } from '@/lib/errors';
import { markUploaded, reserveMediaUpload } from '@/lib/media/upload';
import { rateLimit, LIMITS } from '@/lib/rate-limit';

/**
 * Upload without the bytes passing through this application.
 *
 * A hosting platform refuses a request body past a few megabytes before any
 * route runs — Vercel's ceiling is 4.5 MB — which made an ordinary mp3 fail
 * with nothing but "upload failed". Media that size is exactly what this
 * product is for, so the browser writes to object storage directly and this
 * route only brackets it: POST to reserve a row and get a signed destination,
 * PUT to a different host, then PATCH to say it landed.
 *
 * Everything that decides whether the upload is allowed happens in the POST,
 * before a URL exists. Nothing is trusted afterwards except that the object is
 * where we told the browser to put it.
 */
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const ctx = await requireWorkspace(slug, 'media:upload');
    const limit = await rateLimit(`upload:${ctx.workspace.id}`, LIMITS.upload.limit, LIMITS.upload.window);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many uploads in a short time. Wait a moment and try again.' },
        { status: 429 },
      );
    }

    const body = (await request.json()) as {
      name?: unknown; type?: unknown; size?: unknown;
      folderId?: unknown; uploadRequestId?: unknown;
    };
    const file = {
      name: String(body.name ?? ''),
      type: String(body.type ?? ''),
      size: Number(body.size ?? 0),
    };

    const reserved = await reserveMediaUpload(slug, file, {
      folderId: typeof body.folderId === 'string' ? body.folderId : null,
      uploadRequestId: typeof body.uploadRequestId === 'string' ? body.uploadRequestId : null,
    });
    return NextResponse.json(reserved, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.detail) console.error('[api] media upload reserve', appError.detail);
    return NextResponse.json({ error: appError.message }, { status: appError.status });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const ctx = await requireWorkspace(slug, 'media:upload');
    const { assetId } = (await request.json()) as { assetId?: unknown };

    // Re-read rather than trust the body: the id is the only thing the browser
    // sends back, and it must name a row in this workspace that is still
    // waiting for its bytes.
    const asset = await db.mediaAsset.findFirst({
      where: { id: String(assetId ?? ''), workspaceId: ctx.workspace.id },
      select: { id: true, filename: true, size: true, storageKey: true, status: true },
    });
    if (!asset) {
      return NextResponse.json({ error: 'That upload is no longer waiting.' }, { status: 404 });
    }

    await markUploaded({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      assetId: asset.id,
      filename: asset.filename,
      size: asset.size,
    });
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.detail) console.error('[api] media upload complete', appError.detail);
    return NextResponse.json({ error: appError.message }, { status: appError.status });
  }
}
