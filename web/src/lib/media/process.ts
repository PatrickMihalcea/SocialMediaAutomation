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
import { analyseAudioAsset } from '@/lib/audio/analyse';
import { notify } from '@/lib/notifications/service';
import { renderVideoEdit } from '@/lib/media/ffmpeg-edit';

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
    } else if (asset.type === MediaType.AUDIO) {
      // Audio used to fall through the video branch and come out with nothing
      // measured. It gets its own branch now: a duration from ffprobe when
      // that exists, and a beat grid from the analyser when that does.
      const probed = await probeAudio(bytes, asset.filename).catch(() => null);
      await db.mediaAsset.update({
        where: { id: asset.id },
        data: { duration: probed?.duration ?? asset.duration, status: MediaStatus.READY },
      });

      // Deliberately swallowed. A machine with no Python must not turn a
      // perfectly good mp3 into a FAILED asset — the same stance probeVideo
      // takes when ffmpeg is missing.
      await analyseAudioAsset(asset.id).catch((error) =>
        console.warn('[media] beat analysis skipped', asset.filename, error?.message ?? error),
      );
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

/** Duration only. Returns null when ffprobe is absent, which is a valid state. */
async function probeAudio(bytes: Buffer, filename: string): Promise<{ duration?: number } | null> {
  if (!(await hasFfmpeg())) return null;
  const dir = await mkdtemp(path.join(tmpdir(), 'b88-audio-'));
  const input = path.join(dir, filename.replace(/[^\w.-]/g, '_'));
  try {
    await writeFile(input, bytes);
    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      input,
    ]);
    const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
    return { duration: parsed.format?.duration ? Number(parsed.format.duration) : undefined };
  } finally {
    await rm(dir, { recursive: true, force: true });
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

export interface FfmpegCapabilities {
  ffmpeg: boolean;
  /** Absent from any build without --enable-libfreetype, including Homebrew's. */
  drawtext: boolean;
  zoompan: boolean;
  libx264: boolean;
  /** Major version, 0 when it could not be parsed. */
  majorVersion: number;
  /**
   * How this build wants a filter graph read from a file. `-filter_complex_script`
   * was removed in ffmpeg 8 in favour of the generic `-/filter_complex` syntax,
   * so the flag has to be chosen rather than assumed.
   */
  filterScriptFlag: '-/filter_complex' | '-filter_complex_script';
}

let capabilities: FfmpegCapabilities | null = null;

/**
 * What this ffmpeg can actually do, probed once.
 *
 * hasFfmpeg() only answers whether the binary exists, which is not the same
 * question: a static build without libfreetype has no drawtext at all, and the
 * render would fail at graph-parse time with a message about an unknown filter.
 */
export async function ffmpegCapabilities(): Promise<FfmpegCapabilities> {
  if (capabilities) return capabilities;
  if (!(await hasFfmpeg())) {
    capabilities = {
      ffmpeg: false,
      drawtext: false,
      zoompan: false,
      libx264: false,
      majorVersion: 0,
      filterScriptFlag: '-/filter_complex',
    };
    return capabilities;
  }
  try {
    const [filters, encoders, version] = await Promise.all([
      run('ffmpeg', ['-hide_banner', '-filters']),
      run('ffmpeg', ['-hide_banner', '-encoders']),
      run('ffmpeg', ['-hide_banner', '-version']),
    ]);
    const major = Number(version.stdout.match(/ffmpeg version n?(\d+)/)?.[1] ?? 0);
    const hasFilter = (name: string) => new RegExp(`\\b${name}\\b`).test(filters.stdout);
    capabilities = {
      ffmpeg: true,
      drawtext: hasFilter('drawtext'),
      zoompan: hasFilter('zoompan'),
      libx264: /\blibx264\b/.test(encoders.stdout),
      majorVersion: major,
      // The file-valued option syntax arrived in 6.1; the old flag was removed
      // in 8. Anything from 7 up is safe on the new one.
      filterScriptFlag: major >= 7 ? '-/filter_complex' : '-filter_complex_script',
    };
    if (!capabilities.drawtext) {
      console.warn(
        '[media] this ffmpeg has no drawtext filter (built without libfreetype) — ' +
          'labels will be burned into the stills instead, using a system font',
      );
    }
  } catch {
    capabilities = {
      ffmpeg: true,
      drawtext: false,
      zoompan: false,
      libx264: false,
      majorVersion: 0,
      filterScriptFlag: '-/filter_complex',
    };
  }
  return capabilities;
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
    output = await renderVideoEdit(sourceBytes, source.filename, {
      startSeconds: input.edit.trimStart,
      endSeconds: input.edit.trimEnd,
      crop: input.edit.crop,
      resize: input.edit.resize,
    });
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
