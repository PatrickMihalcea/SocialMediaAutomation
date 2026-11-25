import 'server-only';
import { storage } from '@/lib/storage';

/**
 * Small files in storage the Mac worker and the app talk through, instead of
 * the database.
 *
 * Neon's free plan is 100 compute hours a month, and the database only sleeps
 * after five quiet minutes. A worker asking it for work every few seconds kept
 * it awake around the clock and used the month up in three weeks. Storage
 * reads are free by the million, so the worker watches these instead and only
 * opens the database when there is a reason to.
 */
const WAKE_KEY = 'system/local-worker/wake.json';
const HEARTBEAT_KEY = 'system/local-worker/heartbeat.json';

/** Tells the Mac there is new local work. Never fails the caller. */
export async function signalLocalWork(): Promise<void> {
  await storage()
    .put(WAKE_KEY, Buffer.from(JSON.stringify({ at: Date.now() })), 'application/json')
    .catch((error: unknown) => console.warn('[local-signal] could not signal the local worker', error));
}

/** When local work was last signalled, or null if never or unreadable. */
export async function lastLocalWorkSignal(): Promise<number | null> {
  return readAt(WAKE_KEY);
}

export async function writeLocalHeartbeat(detail: { comfyui: boolean }): Promise<void> {
  await storage().put(HEARTBEAT_KEY, Buffer.from(JSON.stringify({ at: Date.now(), ...detail })), 'application/json');
}

export async function readLocalHeartbeat(): Promise<{ at: number; comfyui: boolean } | null> {
  try {
    const value = JSON.parse((await storage().get(HEARTBEAT_KEY)).toString('utf8')) as { at?: unknown; comfyui?: unknown };
    return typeof value.at === 'number' ? { at: value.at, comfyui: value.comfyui === true } : null;
  } catch {
    return null;
  }
}

async function readAt(key: string): Promise<number | null> {
  try {
    const value = JSON.parse((await storage().get(key)).toString('utf8')) as { at?: unknown };
    return typeof value.at === 'number' ? value.at : null;
  } catch {
    return null;
  }
}
