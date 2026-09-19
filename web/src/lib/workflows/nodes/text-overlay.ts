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
import { connectedText } from '@/lib/workflows/connected-text';
import {
  inferOverlayStructure,
  isOverlayStructure,
  overlayPatterns,
  renderTextOverlayLabels,
  type OverlayStructure,
} from '@/lib/workflows/text-overlay-template';

const run_ = promisify(execFile);

interface Config {
  structure: OverlayStructure;
  template: string;
  firstTemplate: string | null;
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

  if (!videoId) throw new PermanentJobError('No video reached this step.');

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

  const segments = cutPointsOf(video.derivationPreset);
  if (!segments) {
    throw new PermanentJobError(
      'This video has no cut points recorded, so there is nowhere to put labels. Connect the video from a Beat slideshow step.',
    );
  }

  const width = video.width ?? 1080;
  const height = video.height ?? 1920;

  // Either template can be written upstream instead of typed here, so an
  // opening line can be generated per run. Tokens are still expanded, because
  // the text is a template wherever it came from.
  const opening = connectedText(ctx.inputs.firstTemplate) || config.firstTemplate || '';
  const structure = isOverlayStructure(config.structure)
    ? config.structure
    : inferOverlayStructure(config);
  const patterns = overlayPatterns(structure, opening);
  const rest = patterns.rest;
  const labels = renderTextOverlayLabels(rest, patterns.first, segments);

  const fontSizes = overlayFontSizes({
    labels,
    hasOpening: patterns.first !== null,
    configuredSize: config.fontSize,
    font: config.font,
    width,
  });

  const dir = await mkdtemp(path.join(tmpdir(), 'b88-overlay-'));
  try {
    const source = path.join(dir, 'in.mp4');
    await writeFile(source, await storage().get(video.storageKey));

    const overlayPaths: string[] = [];
    for (const [index, label] of labels.entries()) {
      const fontSize = fontSizes[index];
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
    const filename = outputName(ctx.workflowName, 'labelled', ctx.runId, 'mp4');
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
        // The effective templates, not the typed ones: a connected value is
        // what actually produced these labels.
        derivationPreset: JSON.stringify({
          kind: 'text-overlay',
          structure,
          template: rest,
          firstTemplate: patterns.first,
          labels,
        }),
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


/**
 * Reads the cut points a Beat slideshow recorded on the video it produced.
 *
 * Null rather than an empty list when there are none, so the step can tell
 * "this video was not cut into clips" from "it was, into none" — the first is a
 * miswired graph and worth saying plainly.
 */
export function cutPointsOf(derivationPreset: string | null): BeatSegment[] | null {
  if (!derivationPreset) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(derivationPreset);
  } catch {
    return null;
  }
  const cutPoints = (parsed as { cutPoints?: unknown } | null)?.cutPoints;
  if (!Array.isArray(cutPoints) || cutPoints.length === 0) return null;
  // Frame bounds are what the label graph is built from; a record missing them
  // is not one this step can use.
  return cutPoints.every(
    (point) =>
      point && typeof point === 'object'
      && typeof (point as BeatSegment).startFrame === 'number'
      && typeof (point as BeatSegment).endFrame === 'number',
  )
    ? (cutPoints as BeatSegment[])
    : null;
}

/**
 * Font sizes for each rendered cut.
 *
 * An opening question and the later choice labels play different visual roles.
 * Fitting one long opening sentence and then reusing that tiny size for "1",
 * "2", and "3" made the choices practically invisible. Automatic sizing now
 * fits the opening on its own and gives all later labels one consistent size.
 * An explicit size still means exactly one size everywhere.
 */
export function overlayFontSizes(input: {
  labels: string[];
  hasOpening: boolean;
  configuredSize: number;
  font: string;
  width: number;
}): number[] {
  if (input.labels.length === 0) return [];
  if (input.configuredSize > 0) {
    return input.labels.map(() => input.configuredSize);
  }

  const fit = (labels: string[]) => {
    const longest = labels.reduce((current, label) =>
      label.length > current.length ? label : current, '');
    return fitFontSize({ text: longest, font: input.font, maxWidth: input.width });
  };

  if (!input.hasOpening || input.labels.length === 1) {
    const size = fit(input.labels);
    return input.labels.map(() => size);
  }

  const openingSize = fit([input.labels[0]]);
  const choiceSize = fit(input.labels.slice(1));
  return [openingSize, ...input.labels.slice(1).map(() => choiceSize)];
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

/**
 * A filename someone will recognise in the media library.
 *
 * Output used to be named with an epoch timestamp, which the library's
 * humaniser strips back to a single adjective — a draft would show "Labelled"
 * rather than anything resembling the video. The workflow name plus a short run
 * id keeps it readable and still unique.
 */
function outputName(workflowName: string, suffix: string, runId: string, extension: string): string {
  const stem =
    workflowName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'workflow';
  return `${stem}-${suffix}-${runId.slice(0, 6)}.${extension}`;
}
