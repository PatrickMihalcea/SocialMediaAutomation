import 'server-only';
import { createHmac } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/lib/env';
import type { StorageDriver, StoredObject } from '@/lib/storage/types';

const ROOT = path.join(process.cwd(), 'storage');

/**
 * Disk-backed storage for development. Objects are served through
 * /api/storage/[...key] with an HMAC-signed, expiring token, so the access
 * pattern matches the signed-URL model S3 uses in production.
 *
 * Not for production: a network that fetches media itself (Instagram, TikTok)
 * cannot reach localhost.
 */
export class LocalStorage implements StorageDriver {
  readonly name = 'local' as const;

  private resolve(key: string): string {
    const safe = path
      .normalize(key)
      .replace(/^(\.\.(\/|\\|$))+/, '')
      .replace(/^[/\\]+/, '');
    const full = path.join(ROOT, safe);
    if (!full.startsWith(ROOT)) throw new Error('Refusing to write outside the storage root');
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
    return { key, size: body.byteLength, contentType };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async signedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const expires = Date.now() + expiresInSeconds * 1000;
    const token = signKey(key, expires);
    return `${env.NODE_ENV === 'production' ? '' : ''}/api/storage/${key.split('/').map(encodeURIComponent).join('/')}?expires=${expires}&token=${token}`;
  }
}

export function signKey(key: string, expires: number): string {
  return createHmac('sha256', env.AUTH_SECRET).update(`${key}:${expires}`).digest('hex');
}

export function verifyKeySignature(key: string, expires: number, token: string): boolean {
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = signKey(key, expires);
  return expected.length === token.length && expected === token;
}
