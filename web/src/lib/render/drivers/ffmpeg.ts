import 'server-only';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { env } from '@/lib/env';
import { ffmpegCapabilities } from '@/lib/media/process';
import { buildEncoderArgs, buildFilterGraph } from '@/lib/render/graph-builder';
import { buildClipInputArgs } from '@/lib/render/input-args';
import type { RenderPlan, RenderResult, ResolvedRenderPlan, VideoRenderer } from '@/lib/render/types';

const run = promisify(execFile);

/**
 * One ffmpeg invocation per render.
 *
 * The graph goes to a file rather than argv: there is no length limit, no shell
 * escaping, and the file is the same string the snapshot test asserts on, so a
 * failing render can be reproduced by hand from the temp directory.
 */
export class FfmpegRenderer implements VideoRenderer {
  readonly name = 'ffmpeg' as const;

  async isAvailable(): Promise<boolean> {
    const caps = await ffmpegCapabilities();
    return caps.ffmpeg && caps.zoompan && caps.libx264;
  }

  async render(plan: RenderPlan): Promise<RenderResult> {
    const caps = await ffmpegCapabilities();
    const dir = await mkdtemp(path.join(tmpdir(), 'b88-render-'));
    try {
      const clipPaths: Array<{ file: string; kind: 'image' | 'video' }> = [];
      for (const [index, clip] of plan.clips.entries()) {
        const extension = clip.kind === 'image' ? 'png' : videoExtension(clip.mimeType);
        const file = path.join(dir, `${String(index).padStart(2, '0')}.${extension}`);
        await writeFile(file, clip.bytes);
        clipPaths.push({ file, kind: clip.kind });
      }

      // Overlay text goes to files, which shrinks drawtext's double-escaping
      // surface down to a path we control.
      const resolved: ResolvedRenderPlan = {
        ...plan,
        segments: await Promise.all(
          plan.segments.map(async (segment, index) => ({
            ...segment,
            overlays: await Promise.all(
              segment.overlays.map(async (overlay, position) => {
                const file = path.join(dir, `t${index}_${position}.txt`);
                await writeFile(file, overlay.text, 'utf8');
                return { ...overlay, textFile: file };
              }),
            ),
          })),
        ),
      };

      const graphPath = path.join(dir, 'graph.txt');
      await writeFile(graphPath, buildFilterGraph(resolved), 'utf8');

      let audioPath: string | null = null;
      if (plan.audio) {
        audioPath = path.join(dir, 'audio.bin');
        await writeFile(audioPath, plan.audio.bytes);
      }

      const output = path.join(dir, 'out.mp4');
      const args = [
        '-hide_banner',
        '-nostdin',
        '-v', 'error',
        '-y',
        ...buildClipInputArgs(clipPaths),
        ...(audioPath ? ['-i', audioPath] : []),
        caps.filterScriptFlag, graphPath,
        ...buildEncoderArgs(plan),
        output,
      ];

      await run('ffmpeg', args, {
        timeout: env.RENDER_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        // Node's 1 MB default truncates a graph-parse error into an ENOBUFS
        // that says nothing about what actually went wrong.
        maxBuffer: 8 * 1024 * 1024,
      });

      const data = await readFile(output);
      return {
        data,
        mimeType: 'video/mp4',
        extension: 'mp4',
        width: plan.width,
        height: plan.height,
        durationSeconds: plan.totalFrames / plan.fps,
        renderer: `ffmpeg-${caps.majorVersion}/${plan.deterministic ? 'threads-1' : 'threads-4'}`,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function videoExtension(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('quicktime')) return 'mov';
  return 'mp4';
}
