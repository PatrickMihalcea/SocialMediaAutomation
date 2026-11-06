import { JobStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { runJob } from '@/lib/queue/runner';
import { LOCAL_QUEUES, reclaimLocalJobs } from '@/lib/queue/store';
import { ComfyClient } from '@/lib/ai/providers/comfyui';
import { LOCAL_WORKER_ID } from '@/lib/queue/local-worker';

/**
 * The worker that runs on the operator's Mac, beside ComfyUI.
 *
 * It takes LOCAL_QUEUE jobs and nothing else — publishing, renders and every
 * other provider stay with the cloud worker — so switching the laptop off
 * pauses ComfyUI generation and nothing more. Work queued meanwhile waits
 * rather than failing, and runs once this is started again.
 *
 * It talks to the same database and storage as production, which is how the
 * results reach the app: a finished image is an R2 object and a row like any
 * other. Nothing listens on this machine and nothing needs to reach it.
 */

const POLL_MS = 3_000;
const HEARTBEAT_MS = 30_000;
/**
 * One at a time by default. A laptop has one GPU, and two renders sharing it
 * each take twice as long while holding twice the memory — the second is more
 * likely to fail than to finish sooner.
 */
const CONCURRENCY = Number(process.env.LOCAL_WORKER_CONCURRENCY) || 1;

async function main() {
  if (!env.COMFYUI_URL) {
    console.error('[local-worker] COMFYUI_URL is not set; there is nothing for this worker to do.');
    process.exit(1);
  }
  const comfy = new ComfyClient(env.COMFYUI_URL);
  const inFlight = new Set<string>();
  let stopping = false;
  let comfyUp = false;
  let lastBeat = 0;

  const reclaimed = await reclaimLocalJobs();
  if (reclaimed > 0) console.log(`[local-worker] picked up ${reclaimed} job(s) a previous run left unfinished`);
  console.log(`[local-worker] started — ComfyUI at ${env.COMFYUI_URL}, storage=${env.STORAGE_DRIVER}, concurrency ${CONCURRENCY}`);

  const stop = () => {
    // Whatever is mid-render is abandoned and reclaimed on the next start.
    // Waiting could mean half an hour of a video nobody can see progressing.
    if (stopping) process.exit(0);
    stopping = true;
    console.log(`[local-worker] stopping; ${inFlight.size} job(s) will be picked up again next start`);
    void db.$disconnect().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    const up = await comfy.ping();
    if (up !== comfyUp) {
      comfyUp = up;
      console.log(up ? '[local-worker] ComfyUI is answering; taking work' : '[local-worker] ComfyUI is not answering; holding work until it is');
    }

    if (Date.now() - lastBeat > HEARTBEAT_MS) {
      lastBeat = Date.now();
      await db.workerHeartbeat.upsert({
        where: { id: LOCAL_WORKER_ID },
        create: { id: LOCAL_WORKER_ID, seenAt: new Date(), detail: { comfyui: up } },
        update: { seenAt: new Date(), detail: { comfyui: up } },
      }).catch((error: unknown) => console.error('[local-worker] could not record heartbeat', error));
    }

    // Only while ComfyUI answers. A job claimed against a closed ComfyUI would
    // spend an attempt failing; left in the queue it just waits.
    const capacity = up ? CONCURRENCY - inFlight.size : 0;
    if (capacity > 0) {
      const due = await db.job.findMany({
        where: { ...LOCAL_QUEUES, status: JobStatus.QUEUED, runAt: { lte: new Date() } },
        orderBy: { runAt: 'asc' },
        take: capacity,
        select: { id: true, type: true },
      }).catch((error: unknown) => {
        console.error('[local-worker] could not read the queue', error);
        return [];
      });
      for (const job of due) {
        if (inFlight.has(job.id)) continue;
        inFlight.add(job.id);
        console.log(`[local-worker] running ${job.type} ${job.id}`);
        const started = Date.now();
        void runJob(job.id)
          .catch((error) => console.error('[local-worker] job failed outside the runner', job.id, error))
          .finally(() => {
            inFlight.delete(job.id);
            console.log(`[local-worker] finished ${job.id} in ${Math.round((Date.now() - started) / 1000)}s`);
          });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error('[local-worker] failed', error);
  process.exit(1);
});
