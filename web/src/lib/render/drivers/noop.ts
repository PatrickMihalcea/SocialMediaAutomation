import 'server-only';
import { PermanentJobError } from '@/lib/queue/runner';
import type { RenderPlan, RenderResult, VideoRenderer } from '@/lib/render/types';

/**
 * Selected when no encoder is configured or available, so "ffmpeg is missing"
 * and "no renderer is set up" are the same code path rather than two failure
 * modes that behave differently.
 */
export class NoopRenderer implements VideoRenderer {
  readonly name = 'none' as const;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async render(_plan: RenderPlan): Promise<RenderResult> {
    throw new PermanentJobError(
      'Video rendering is not set up on this deployment. Install ffmpeg and set RENDER_DRIVER=ffmpeg.',
    );
  }
}
