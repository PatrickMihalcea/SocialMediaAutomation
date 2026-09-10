import { createHash } from 'node:crypto';

/**
 * A publish attempt is identified by (post, channel) — not by attempt number —
 * so every retry of the same logical publish carries the same key.
 *
 * Three things use it:
 *  1. Adapters that accept a client dedupe token pass it upstream.
 *  2. The column is unique, so two PostPlatform rows can never share one.
 *  3. The mock adapter derives its post id from it, which is what lets the
 *     retry tests assert that a double publish produces one post, not two.
 */
export function idempotencyKey(postId: string, socialAccountId: string): string {
  return createHash('sha256').update(`${postId}:${socialAccountId}`).digest('hex').slice(0, 40);
}
