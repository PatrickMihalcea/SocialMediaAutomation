import 'server-only';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { MediaStatus, MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { mediaKey, storage } from '@/lib/storage';
import { PermanentJobError } from '@/lib/queue/runner';
import { notify } from '@/lib/notifications/service';

const run = promisify(execFile);

/**
 * Expensive media work runs as a background job so an upload returns as soon as
 * the bytes are stored.
 *
 * Images are probed and thumbnailed with sharp. Video needs ffmpeg/ffprobe: when
 * they are not on PATH the asset still becomes usable — it keeps the dimensions
 * and duration the browser reported at upload — but it gets no generated poster
 * frame, and the composer falls back to a labelled placeholder.
 */
export async function processMediaAsset(mediaAssetId: string): Promise<void> {
  const asset = await db.mediaAsset.findUnique({
    where: { id: mediaAssetId },
    include: { workspace: { select: { slug: true } } },
  });
  if (!asset) throw new PermanentJobError(`Media asset ${mediaAssetId} no longer exists`);

  try {
    const bytes = await storage().get(asset.storageKey);

    if (asset.type === MediaType.IMAGE || asset.type === MediaType.GIF) {
      const meta = await sharp(bytes).metadata();
      const thumbnail = await sharp(bytes)
        .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      const thumbKey = mediaKey(asset.workspaceId, `${asset.filename}.webp`, 'thumb');
      await storage().put(thumbKey, thumbnail, 'image/webp');

      await db.mediaAsset.update({
        where: { id: asset.id },
        data: {
          width: meta.width ?? asset.width,
          height: meta.height ?? asset.height,
          thumbnailKey: thumbKey,
          status: MediaStatus.READY,
        },
      });
    } else {
      const edit = parseVideoEdit(asset.derivationPreset);
      const probed = asset.type === MediaType.VIDEO
        ? await probeVideo(bytes, asset.filename, edit?.thumbnailOffset).catch(() => null)
        : null;
      const thumbKey = probed?.poster
        ? mediaKey(asset.workspaceId, `${asset.filename}.webp`, 'thumb')
        : null;
      if (thumbKey && probed?.poster) await storage().put(thumbKey, probed.poster, 'image/webp');

      await db.mediaAsset.update({
        where: { id: asset.id },
        data: {
          width: probed?.width ?? asset.width,
          height: probed?.height ?? asset.height,
          duration: probed?.duration ?? asset.duration,
          thumbnailKey: thumbKey,
          status: MediaStatus.READY,
        },
      });
    }

    if (asset.uploadedById) {
      await notify({
        workspaceId: asset.workspaceId,
        userIds: [asset.uploadedById],
        type: 'MEDIA_PROCESSING_COMPLETE',
        title: 'Media is ready',
        href: `/w/${asset.workspace.slug}/media`,
      });
    }
  } catch (error) {
    await db.mediaAsset.update({ where: { id: asset.id }, data: { status: MediaStatus.FAILED } });
    throw error;
  }
}

interface Probe {
  width?: number;
  height?: number;
  duration?: number;
  poster?: Buffer;
}

/** Returns nothing useful when ffmpeg is not installed, which is a valid state. */
async function probeVideo(bytes: Buffer, filename: string, thumbnailOffset = 1): Promise<Probe | null> {
  if (!(await hasFfmpeg())) return null;

  const dir = await mkdtemp(path.join(tmpdir(), 'b88-media-'));
  const input = path.join(dir, filename.replace(/[^\w.-]/g, '_'));
  const frame = path.join(dir, 'frame.png');
  try {
    await writeFile(input, bytes);

    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      input,
    ]);
    const parsed = JSON.parse(stdout) as {
      streams?: { width?: number; height?: number }[];
      format?: { duration?: string };
    };

    await run('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, thumbnailOffset)), '-i', input, '-vframes', '1', '-y', frame]);
    const poster = await sharp(await readFile(frame))
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    return {
      width: parsed.streams?.[0]?.width,
      height: parsed.streams?.[0]?.height,
      duration: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
      poster,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let ffmpegAvailable: boolean | null = null;

export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await run('ffprobe', ['-version']);
    ffmpegAvailable = true;
  } catch {
    console.warn('[media] ffmpeg/ffprobe not found — video posters will be skipped');
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

/** Server-side derivative used by the media editor's crop/resize presets. */
export async function createImageDerivative(input: {
  sourceAssetId: string;
  crop?: { left: number; top: number; width: number; height: number };
  rotate?: number;
  resize?: { width: number; height: number };
  presetId?: string;
  presetLabel?: string;
  userId?: string;
}): Promise<string> {
  const source = await db.mediaAsset.findUniqueOrThrow({ where: { id: input.sourceAssetId } });
  if (source.type === MediaType.VIDEO) {
    throw new PermanentJobError('Video derivatives need ffmpeg and are not produced here.');
  }

  let pipeline = sharp(await storage().get(source.storageKey));
  if (input.rotate) pipeline = pipeline.rotate(input.rotate);
  if (input.crop) pipeline = pipeline.extract(input.crop);
  if (input.resize) {
    pipeline = pipeline.resize(input.resize.width, input.resize.height, { fit: 'cover', position: 'centre' });
  }

  const output = await pipeline.jpeg({ quality: 90 }).toBuffer();
  const meta = await sharp(output).metadata();
  const filename = derivativeName(source.filename, input.presetId);
  const key = mediaKey(source.workspaceId, filename, 'derived');
  await storage().put(key, output, 'image/jpeg');

  const created = await db.mediaAsset.create({
    data: {
      workspaceId: source.workspaceId,
      folderId: source.folderId,
      uploadedById: input.userId ?? source.uploadedById,
      filename,
      mimeType: 'image/jpeg',
      type: MediaType.IMAGE,
      size: output.byteLength,
      width: meta.width ?? null,
      height: meta.height ?? null,
      storageKey: key,
      altText: source.altText,
      status: MediaStatus.PROCESSING,
      // The original is never overwritten — a derivative is a new asset that
      // points back at what it came from.
      derivedFromId: source.id,
      derivationPreset: input.presetLabel ?? input.presetId ?? 'custom',
    },
  });
  return created.id;
}

export interface VideoEdit {
  trimStart?: number;
  trimEnd?: number;
  thumbnailOffset?: number;
  crop?: { left: number; top: number; width: number; height: number };
  resize?: { width: number; height: number };
}

/**
 * Creates a new video asset. Without ffmpeg the source bytes are copied to a
 * distinct object and the requested edit is retained as metadata for a future
 * processing worker; the original is still never changed.
 */
export async function createVideoDerivative(input: {
  sourceAssetId: string;
  edit: VideoEdit;
  presetId?: string;
  presetLabel?: string;
  userId?: string;
}): Promise<{ id: string; rendered: boolean }> {
  const source = await db.mediaAsset.findUniqueOrThrow({ where: { id: input.sourceAssetId } });
  if (source.type !== MediaType.VIDEO) throw new PermanentJobError('Only videos can use the video editor.');

  const sourceBytes = await storage().get(source.storageKey);
  const rendered = await hasFfmpeg();
  let output = sourceBytes;

  if (rendered) {
    const dir = await mkdtemp(path.join(tmpdir(), 'b88-media-edit-'));
    const sourceExt = path.extname(source.filename) || '.mp4';
    const sourcePath = path.join(dir, `source${sourceExt}`);
    const outputPath = path.join(dir, 'output.mp4');
    try {
      await writeFile(sourcePath, sourceBytes);
      const filters: string[] = [];
      if (input.edit.crop) {
        const { width, height, left, top } = input.edit.crop;
        filters.push(`crop=${width}:${height}:${left}:${top}`);
      }
      if (input.edit.resize) filters.push(`scale=${input.edit.resize.width}:${input.edit.resize.height}`);
      const args = ['-v', 'error'];
      if (input.edit.trimStart !== undefined) args.push('-ss', String(Math.max(0, input.edit.trimStart)));
      args.push('-i', sourcePath);
      if (input.edit.trimEnd !== undefined) {
        const duration = Math.max(0.01, input.edit.trimEnd - (input.edit.trimStart ?? 0));
        args.push('-t', String(duration));
      }
      if (filters.length) args.push('-vf', filters.join(','));
      args.push('-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', '-y', outputPath);
      await run('ffmpeg', args);
      output = await readFile(outputPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const filename = videoDerivativeName(source.filename, input.presetId, rendered);
  const key = mediaKey(source.workspaceId, filename, 'derived');
  await storage().put(key, output, 'video/mp4');
  const metadata = JSON.stringify({
    kind: 'video-edit',
    label: input.presetLabel ?? input.presetId ?? 'custom',
    rendered,
    ...input.edit,
  });
  const created = await db.mediaAsset.create({
    data: {
      workspaceId: source.workspaceId,
      folderId: source.folderId,
      uploadedById: input.userId ?? source.uploadedById,
      filename,
      mimeType: rendered ? 'video/mp4' : source.mimeType,
      type: MediaType.VIDEO,
      size: output.byteLength,
      storageKey: key,
      altText: source.altText,
      status: MediaStatus.PROCESSING,
      derivedFromId: source.id,
      derivationPreset: metadata,
    },
  });
  return { id: created.id, rendered };
}

function derivativeName(original: string, presetId?: string): string {
  const dot = original.lastIndexOf('.');
  const stem = dot > 0 ? original.slice(0, dot) : original;
  return `${stem}-${presetId ?? 'edit'}.jpg`;
}

function videoDerivativeName(original: string, presetId?: string, rendered = true): string {
  const dot = original.lastIndexOf('.');
  const stem = dot > 0 ? original.slice(0, dot) : original;
  const extension = rendered ? '.mp4' : dot > 0 ? original.slice(dot) : '.mp4';
  return `${stem}-${presetId ?? 'edit'}${extension}`;
}

function parseVideoEdit(value: string | null): VideoEdit | null {
  if (!value?.startsWith('{')) return null;
  try {
    return JSON.parse(value) as VideoEdit;
  } catch {
    return null;
  }
}
