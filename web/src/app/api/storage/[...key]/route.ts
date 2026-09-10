import { NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { verifyKeySignature } from '@/lib/storage/local';
import { env } from '@/lib/env';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  if (env.STORAGE_DRIVER !== 'local') return new NextResponse(null, { status: 404 });
  const { key: parts } = await params;
  const key = parts.join('/');
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get('expires'));
  const token = url.searchParams.get('token') ?? '';
  if (!verifyKeySignature(key, expires, token)) {
    return NextResponse.json({ error: 'This media link has expired.' }, { status: 403 });
  }
  try {
    const bytes = await storage().get(key);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'content-type': contentType(key),
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

function contentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  return {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    gif: 'image/gif', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime',
    webm: 'video/webm',
  }[ext ?? ''] ?? 'application/octet-stream';
}
