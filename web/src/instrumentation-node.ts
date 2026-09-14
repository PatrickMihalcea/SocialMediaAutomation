import { env } from '@/lib/env';
import { queue } from '@/lib/queue';

/**
 * Runs the in-process queue inside the web server, which only happens when
 * QUEUE_IN_WEB_SERVER is set.
 *
 * Off by default because the queue must have exactly one owner. A web server
 * that also consumes jobs races the worker for them, and it is the one more
 * likely to lose in a way that looks like a broken workflow: it reaches node
 * executors through dynamic import, so in development a job that starts after a
 * recompile dies with "Failed to load chunk", and against a stale production
 * build it dies inside minified code with an error naming no recognisable
 * function. Either way the step fails, the sweeper redispatches it, the same
 * server grabs it again, and the run appears to hang rather than to fail.
 *
 * Normal setup is `npm run worker` alongside the web server; it owns the queue,
 * the run sweeper and the schedule scan. Set QUEUE_IN_WEB_SERVER=true only
 * where no separate worker process can run, and then do not start a worker.
 */
if (env.QUEUE_DRIVER === 'in-process') {
  if (env.QUEUE_IN_WEB_SERVER) {
    await queue().start();
    console.log('[queue] started in the web server — do not also run a worker');
  } else {
    console.log('[queue] owned by the worker, not this server. Run: npm run worker');
  }
}
