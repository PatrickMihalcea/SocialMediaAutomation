import 'server-only';
import { JobStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { LOCAL_QUEUES } from '@/lib/queue/store';

export const LOCAL_WORKER_ID = 'local';

/** Four missed heartbeats. Long enough to ride out a slow query, short enough to be true. */
const FRESH_MS = 2 * 60 * 1000;

export interface LocalWorkerStatus {
  /** The worker has checked in recently. */
  online: boolean;
  /** It could reach ComfyUI when it did. */
  comfyui: boolean;
  seenAt: string | null;
  /** Local jobs waiting, which is what makes "offline" worth saying. */
  queued: number;
}

/**
 * Whether anything is going to run ComfyUI work.
 *
 * Queued work waits for the Mac rather than failing, which is right but
 * silent: without this, a step sitting QUEUED because the laptop is closed
 * looks exactly like one sitting QUEUED because something is broken.
 */
export async function localWorkerStatus(): Promise<LocalWorkerStatus> {
  const [beat, queued] = await Promise.all([
    db.workerHeartbeat.findUnique({ where: { id: LOCAL_WORKER_ID } }),
    db.job.count({ where: { ...LOCAL_QUEUES, status: JobStatus.QUEUED } }),
  ]);
  const online = Boolean(beat && Date.now() - beat.seenAt.getTime() < FRESH_MS);
  const detail = (beat?.detail ?? {}) as { comfyui?: unknown };
  return {
    online,
    comfyui: online && detail.comfyui === true,
    seenAt: beat?.seenAt.toISOString() ?? null,
    queued,
  };
}

/** One sentence for whoever is about to queue, or is waiting on, ComfyUI work. */
export function describeLocalWorker(status: LocalWorkerStatus): { tone: 'success' | 'error'; text: string } {
  const waiting = status.queued ? ` ${status.queued} job${status.queued === 1 ? ' is' : 's are'} waiting.` : '';
  if (!status.online) {
    return {
      tone: 'error',
      text: `The local worker is offline, so ComfyUI work will wait until your Mac runs npm run worker:local.${waiting}`,
    };
  }
  if (!status.comfyui) {
    return { tone: 'error', text: `The local worker is running but cannot reach ComfyUI. Start ComfyUI on your Mac.${waiting}` };
  }
  return { tone: 'success', text: `Your Mac is online and ComfyUI is ready.${waiting}` };
}
