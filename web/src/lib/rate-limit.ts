import 'server-only';
import { env } from '@/lib/env';

/**
 * Fixed-window rate limiting. Backed by Redis when the queue driver is on, and
 * by an in-process map otherwise — the in-process counter is per-instance, which
 * is enough for a single dev server but must not be relied on across replicas.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const memory = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  if (env.QUEUE_DRIVER === 'bullmq') {
    try {
      const { getRedis } = await import('@/lib/queue/redis');
      const redis = getRedis();
      const redisKey = `ratelimit:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.pexpire(redisKey, windowMs);
      const ttl = await redis.pttl(redisKey);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: now + Math.max(ttl, 0) };
    } catch (error) {
      console.error('[rate-limit] redis unavailable, falling back to memory', error);
    }
  }

  const bucket = memory.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

/** Windows used across the app, named so limits are reviewed in one place. */
export const LIMITS = {
  auth: { limit: 10, window: 300 },
  aiGeneration: { limit: 30, window: 60 },
  upload: { limit: 60, window: 60 },
  mutation: { limit: 120, window: 60 },
  oauth: { limit: 20, window: 300 },
} as const;
