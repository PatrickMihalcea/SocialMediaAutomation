import 'server-only';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { MediaStatus, MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { mediaKey, storage } from '@/lib/storage';
import { enqueue } from '@/lib/queue';
import { PermanentJobError } from '@/lib/queue/runner';
import { ffmpegCapabilities } from '@/lib/media/process';
import type { NodeRunContext } from '@/lib/workflows/node-context';

const run_ = promisify(execFile);

interface Config {
  /** Playback speed in percent: 50 is half speed, 100 unchanged. */
  speed: number;
  smooth: boolean;
}

/**
 * Plays each incoming video faster or slower.
 *
 * The picture is retimed and the sound stretched to match without changing
 * its pitch. A slowed clip otherwise shows each frame for longer, which reads
 * as stepping at half speed; Smooth motion fills the gaps with frames
 * interpolated from the motion between them, at a much higher render cost.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const ids = (Array.isArray(ctx.inputs.videos) ? ctx.inputs.videos : [ctx.inputs.videos])
    .filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) throw new PermanentJobError('No videos reached this step.');

  const caps = await ffmpegCapabilities();
  if (!caps.ffmpeg) {
    throw new PermanentJobError('Video rendering is not set up on this deployment. Install ffmpeg and set RENDER_DRIVER=ffmpeg.');
  }

  const factor = Math.min(2, Math.max(0.25, config.speed / 100));
  const done = Array.isArray(ctx.previousOutput?.videos) ? (ctx.previousOutput.videos as string[]) : [];
  const videos: string[] = [...done];

  for (const id of ids.slice(done.length)) {
    await ctx.assertNotCancelled();
    await ctx.heartbeat();
    const source = await db.mediaAsset.findFirst({
      where: { id, workspaceId: ctx.workspaceId, type: MediaType.VIDEO },
    });
    if (!source) throw new PermanentJobError('A video is no longer in the media library.');

    const dir = await mkdtemp(path.join(tmpdir(), 'b88-speed-'));
    try {
      const input = path.join(dir, `in${path.extname(source.filename) || '.mp4'}`);
      const output = path.join(dir, 'out.mp4');
      await writeFile(input, await storage().get(source.storageKey));
      await run_('ffmpeg', speedArgs(input, output, factor, config.smooth), {
        timeout: env.RENDER_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: 8 * 1024 * 1024,
      });
      const data = await readFile(output);

      const filename = `${path.parse(source.filename).name}-${config.speed}pct.mp4`;
      const key = mediaKey(ctx.workspaceId, filename, 'derived');
      await storage().put(key, data, 'video/mp4');
      const asset = await db.mediaAsset.create({
        data: {
          workspaceId: ctx.workspaceId,
          uploadedById: ctx.userId,
          filename,
          mimeType: 'video/mp4',
          type: MediaType.VIDEO,
          size: data.byteLength,
          width: source.width,
          height: source.height,
          duration: source.duration != null ? source.duration / factor : null,
          storageKey: key,
          status: MediaStatus.READY,
          derivedFromId: source.id,
          derivationPreset: JSON.stringify({ kind: 'speed', speed: config.speed, smooth: config.smooth }),
        },
        select: { id: true },
      });
      videos.push(asset.id);
      await ctx.emitAssets('videos', [asset.id]);
      await ctx.saveProgress({ videos, _progress: { done: videos.length, total: ids.length } });
      await enqueue('process-media', { mediaAssetId: asset.id }, { workspaceId: ctx.workspaceId, dedupeKey: `process-media:${asset.id}` });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return { videos, video: videos[0] };
}

/**
 * The ffmpeg arguments for one video. Exported for its test.
 *
 * atempo keeps the pitch; it takes 0.5 to 2 in one pass, so a quarter speed
 * is two halvings. A video with no sound track simply has nothing to stretch.
 */
export function speedArgs(input: string, output: string, factor: number, smooth: boolean): string[] {
  const tempo = factor < 0.5 ? [0.5, factor / 0.5] : [factor];
  const picture = [
    `setpts=PTS/${factor}`,
    ...(smooth && factor < 1 ? ['minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:vsbmc=1'] : []),
  ].join(',');
  return [
    '-v', 'error', '-y',
    '-i', input,
    '-map', '0:v', '-map', '0:a?',
    '-vf', picture,
    '-af', tempo.map((value) => `atempo=${value}`).join(','),
    '-r', '30',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    output,
  ];
}
