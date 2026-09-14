import 'server-only';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { MediaStatus, MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { mediaKey, storage } from '@/lib/storage';
import { enqueue } from '@/lib/queue';
import { PermanentJobError } from '@/lib/queue/runner';
import { ffmpegCapabilities } from '@/lib/media/process';
import { buildOverlayGraph } from '@/lib/render/graph-builder';
import { fitFontSize, wrapLabel } from '@/lib/render/fonts';
import type { BeatSegment } from '@/lib/render/types';
import type { NodeRunContext } from '@/lib/workflows/node-context';

const run_ = promisify(execFile);

interface Config {
  template: string;
  font: string;
  position: 'top' | 'centre' | 'bottom';
  fontSize: number;
}

/**
 * Burns a label onto each cut.
 *
 * Labels are drawn by sharp into transparent PNGs and composited with ffmpeg's
 * `overlay`, rather than with `drawtext`. `drawtext` needs an ffmpeg built with
 * libfreetype and many builds omit it — the current Homebrew formula included —
 * whereas `overlay` is core and behaves identically everywhere.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const videoId = typeof ctx.inputs.video === 'string' ? ctx.inputs.video : null;
  const segments = ctx.inputs.segments as BeatSegment[] | undefined;

  if (!videoId) throw new PermanentJobError('No video reached this step.');
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new PermanentJobError('No cut points reached this step, so there is nowhere to put labels.');
  }

  const caps = await ffmpegCapabilities();
  if (!caps.ffmpeg) {
    throw new PermanentJobError(
      'Video rendering is not set up on this deployment. Install ffmpeg and set RENDER_DRIVER=ffmpeg.',
    );
  }

  const video = await db.mediaAsset.findFirst({
    where: { id: videoId, workspaceId: ctx.workspaceId, type: MediaType.VIDEO },
  });
  if (!video) throw new PermanentJobError('That video is no longer in the media library.');

  const width = video.width ?? 1080;
  const height = video.height ?? 1920;
  const labels = segments.map((segment) => renderTemplate(config.template, segment));

  // One size for every label, chosen so the longest fits. Sizes that changed per
  // clip would read as a mistake rather than a design.
  const longest = labels.reduce((a, b) => (b.length > a.length ? b : a), '');
  const fontSize =
    config.fontSize > 0
      ? config.fontSize
      : fitFontSize({ text: longest, font: config.font, maxWidth: width });

  const dir = await mkdtemp(path.join(tmpdir(), 'b88-overlay-'));
  try {
    const source = path.join(dir, 'in.mp4');
    await writeFile(source, await storage().get(video.storageKey));

    const overlayPaths: string[] = [];
    for (const [index, label] of labels.entries()) {
      const wrapped = wrapLabel(label, config.font, fontSize, width);
      const png = await renderLabelPng(wrapped, { width, height, fontSize, font: config.font, position: config.position });
      const file = path.join(dir, `overlay-${index}.png`);
      await writeFile(file, png);
      overlayPaths.push(file);
      await ctx.heartbeat();
    }

    const graphPath = path.join(dir, 'graph.txt');
    await writeFile(
      graphPath,
      buildOverlayGraph({
        fps: 30,
        segments: segments.map((s) => ({ startFrame: s.startFrame, endFrame: s.endFrame })),
      }),
      'utf8',
    );

    await ctx.assertNotCancelled();
    const output = path.join(dir, 'out.mp4');
    await run_(
      'ffmpeg',
      [
        '-hide_banner', '-nostdin', '-v', 'error', '-y',
        '-i', source,
        ...overlayPaths.flatMap((file) => ['-i', file]),
        caps.filterScriptFlag, graphPath,
        '-map', '[v]',
        // The audio is already correct; copying avoids a second lossy pass.
        '-map', '0:a?', '-c:a', 'copy',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-fflags', '+bitexact', '-flags', '+bitexact', '-map_metadata', '-1',
        output,
      ],
      { timeout: env.RENDER_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 },
    );

    const data = await readFile(output);
    const filename = `labelled-${Date.now()}.mp4`;
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
        width,
        height,
        duration: video.duration,
        storageKey: key,
        // READY for the same reason as the slideshow step: the encoder already
        // knows the dimensions, and a PROCESSING asset is invisible to the
        // composer. process-media still runs for the poster frame.
        status: MediaStatus.READY,
        derivedFromId: video.id,
        derivationPreset: JSON.stringify({ kind: 'text-overlay', template: config.template, labels }),
      },
      select: { id: true },
    });

    await ctx.emitAssets('video', [asset.id]);
    await enqueue(
      'process-media',
      { mediaAssetId: asset.id },
      { workspaceId: ctx.workspaceId, dedupeKey: `process-media:${asset.id}` },
    );

    return { video: asset.id };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `{index}` is the 1-based cut number; `{title}` is the idea step's own label. */
function renderTemplate(template: string, segment: BeatSegment): string {
  return template
    .replace(/\{index\}/g, String(segment.index + 1))
    .replace(/\{title\}/g, segment.title ?? '')
    .trim();
}

async function renderLabelPng(
  text: string,
  options: { width: number; height: number; fontSize: number; font: string; position: string },
): Promise<Buffer> {
  const lines = text.split('\n').filter(Boolean);
  const lineHeight = options.fontSize * 1.15;
  const block = lineHeight * lines.length;
  const top =
    options.position === 'centre'
      ? (options.height - block) / 2
      : options.position === 'bottom'
        ? options.height - block - options.height * 0.12
        : options.height * 0.1;

  const family = options.font.startsWith('Bebas')
    ? 'Bebas Neue, Oswald, Impact, sans-serif'
    : 'Archivo, Helvetica Neue, Helvetica, Arial, sans-serif';

  const body = lines
    .map(
      (line, i) =>
        `<text x="${options.width / 2}" y="${top + lineHeight * (i + 1)}" text-anchor="middle" ` +
        `font-family="${family}" font-size="${options.fontSize}" font-weight="700" ` +
        `fill="#ffffff" stroke="#000000" stroke-width="${Math.round(options.fontSize * 0.08)}" ` +
        `paint-order="stroke">${escapeXml(line)}</text>`,
    )
    .join('');

  const svg = `<svg width="${options.width}" height="${options.height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
