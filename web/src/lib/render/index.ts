import 'server-only';
import { env } from '@/lib/env';
import { FfmpegRenderer } from '@/lib/render/drivers/ffmpeg';
import { NoopRenderer } from '@/lib/render/drivers/noop';
import type { VideoRenderer } from '@/lib/render/types';

let cached: VideoRenderer | null = null;

/** Matches storage() and aiProvider(): env picks the driver, cached per process. */
export function renderer(): VideoRenderer {
  if (!cached) cached = env.RENDER_DRIVER === 'ffmpeg' ? new FfmpegRenderer() : new NoopRenderer();
  return cached;
}

export type { RenderPlan, RenderResult, VideoRenderer, BeatSegment } from '@/lib/render/types';
