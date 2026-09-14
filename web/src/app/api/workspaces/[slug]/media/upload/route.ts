import { NextResponse } from 'next/server';
import { storeMediaFiles } from '@/lib/media/upload';
import { toAppError } from '@/lib/errors';
import { LIMITS, rateLimit } from '@/lib/rate-limit';
import { requireWorkspace } from '@/lib/auth/guard';

/**
 * Media upload — one file per request, sent as a raw body.
 *
 * Two limits shaped this. A Server Action caps its request body at 1 MB, which
 * is why an ordinary photo failed with "Body exceeded 1 MB limit" before any of
 * the upload's own validation ran. And Node's multipart parser fails on bodies
 * past roughly 10 MB with "Failed to parse body as FormData", which turned a
 * valid 16 MB image into an opaque 500. Sending the bytes as the body, with the
 * metadata in the query string, avoids both.
 *
 * Note for hosted deployments: serverless platforms impose their own request
 * body ceiling (Vercel's is a few MB) whatever this code does. Media past that
 * needs a presigned upload straight to object storage.
 */
export const runtime = 'nodejs';
/** Large files take a while to arrive; the default function timeout is short. */
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  try {
    const ctx = await requireWorkspace(slug, 'media:upload');
    const limit = await rateLimit(
      `upload:${ctx.workspace.id}`,
      LIMITS.upload.limit,
      LIMITS.upload.window,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many uploads in a short time. Wait a moment and try again.' },
        { status: 429 },
      );
    }

    const url = new URL(request.url);
    const filename = url.searchParams.get('filename')?.trim();
    if (!filename) {
      return NextResponse.json({ error: 'The upload is missing its filename.' }, { status: 400 });
    }

    const bytes = await readBody(request);
    if (bytes.byteLength === 0) {
      return NextResponse.json({ error: `${filename} is empty.` }, { status: 400 });
    }

    // Refuse a short read rather than storing a truncated file. Buffering the
    // body with arrayBuffer() silently stopped at 10 MiB and still answered
    // 200, so a large photo landed in the library as unreadable bytes.
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > 0 && bytes.byteLength !== declared) {
      return NextResponse.json(
        {
          error:
            `${filename} only uploaded ${Math.round(bytes.byteLength / 1024 / 1024)} MB of ` +
            `${Math.round(declared / 1024 / 1024)} MB. Try again, or use a smaller file.`,
        },
        { status: 413 },
      );
    }

    // Rebuilt as a File so the shared validation sees exactly what a multipart
    // upload would have produced.
    const file = new File([new Uint8Array(bytes)], filename, {
      type: request.headers.get('content-type') || 'application/octet-stream',
    });

    await storeMediaFiles(slug, [file], {
      folderId: url.searchParams.get('folderId'),
      uploadRequestId: url.searchParams.get('uploadRequestId'),
    });

    return NextResponse.json({ filename, message: 'Media uploaded.' });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.detail) console.error('[api] media upload', appError.detail);
    return NextResponse.json({ error: appError.message }, { status: appError.status });
  }
}

/**
 * Collects the request body by streaming it.
 *
 * `request.arrayBuffer()` truncates at 10 MiB here and reports no error, so the
 * stream is drained by hand and the caller checks the total against
 * Content-Length.
 */
async function readBody(request: Request): Promise<Buffer> {
  if (!request.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
