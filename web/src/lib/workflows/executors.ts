import 'server-only';
import type { NodeExecutor } from '@/lib/workflows/node-context';
import type { NodeType } from '@/lib/workflows/definitions';

/**
 * Node type to implementation, loaded lazily.
 *
 * The dynamic imports are deliberate, for the same reason they are in
 * src/lib/queue/handlers.ts: rendering the canvas or listing runs must not pull
 * sharp, ffmpeg and the OpenAI SDK into a web request. Only a worker that is
 * about to execute a step pays for the module.
 */
const EXECUTORS: Record<NodeType, () => Promise<NodeExecutor>> = {
  IDEA_GENERATOR: async () => (await import('@/lib/workflows/nodes/idea-generator')).run,
  IMAGE_GENERATOR: async () => (await import('@/lib/workflows/nodes/image-generator')).run,
  ANIMATE_IMAGE: async () => (await import('@/lib/workflows/nodes/animate-image')).run,
  MEDIA_LIBRARY: async () => (await import('@/lib/workflows/nodes/media-library')).run,
  MUSIC_SELECTOR: async () => (await import('@/lib/workflows/nodes/music-selector')).run,
  AUDIO_TRIMMER: async () => (await import('@/lib/workflows/nodes/audio-trimmer')).run,
  BEAT_SLIDESHOW: async () => (await import('@/lib/workflows/nodes/beat-slideshow')).run,
  COMBINE_MEDIA: async () => (await import('@/lib/workflows/nodes/combine-media')).run,
  TEXT_OVERLAY: async () => (await import('@/lib/workflows/nodes/text-overlay')).run,
  PICK: async () => (await import('@/lib/workflows/nodes/pick')).run,
  CREATE_DRAFT: async () => (await import('@/lib/workflows/nodes/create-draft')).run,
  PUBLISH: async () => (await import('@/lib/workflows/nodes/publish')).run,
};

export async function getExecutor(type: string): Promise<NodeExecutor | null> {
  const load = (EXECUTORS as Record<string, (() => Promise<NodeExecutor>) | undefined>)[type];
  return load ? load() : null;
}
