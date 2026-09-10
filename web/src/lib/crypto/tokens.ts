import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * AES-256-GCM for OAuth access/refresh tokens at rest. Ciphertext is stored as
 * `v1.<iv>.<authTag>.<payload>`, all base64url — the version prefix leaves room
 * to rotate the algorithm without a migration that has to guess the format.
 */
const VERSION = 'v1';

function key(): Buffer {
  const raw = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64');
  if (raw.length === 32) return raw;
  // Accept a non-base64 passphrase in development by widening it to 32 bytes.
  return createHash('sha256').update(env.TOKEN_ENCRYPTION_KEY).digest();
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const payload = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), payload.toString('base64url')].join('.');
}

export function decryptToken(ciphertext: string): string {
  const [version, iv, tag, payload] = ciphertext.split('.');
  if (version !== VERSION || !iv || !tag || !payload) {
    throw new Error('Stored token is not in a recognised format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8');
}

/** Null-tolerant wrappers — a channel may legitimately have no refresh token. */
export const encryptOptional = (v: string | null | undefined) => (v ? encryptToken(v) : null);
export const decryptOptional = (v: string | null | undefined) => (v ? decryptToken(v) : null);

/** Opaque single-use secret plus its stored hash (verification, reset, invites). */
export function issueSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: hashSecret(secret) };
}

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

export function secretMatches(secret: string, hash: string): boolean {
  const a = Buffer.from(hashSecret(secret));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
