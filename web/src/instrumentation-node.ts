import { env } from '@/lib/env';
import { queue } from '@/lib/queue';

if (env.QUEUE_DRIVER === 'in-process') {
  await queue().start();
}
