import 'server-only';
import IORedis from 'ioredis';
import { env } from '@/lib/env';

const globalForRedis = globalThis as unknown as { redis?: IORedis };

export function getRedis(): IORedis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new IORedis(env.REDIS_URL, {
      // BullMQ requires this to be null so blocking commands are not cut short.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    globalForRedis.redis.on('error', (e) => console.error('[redis]', e.message));
  }
  return globalForRedis.redis;
}
