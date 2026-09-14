import 'server-only';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { env } from '@/lib/env';

const run = promisify(execFile);

export interface VideoEditRange {
  startSeconds?: number;
  endSeconds?: number;
  crop?: { left: number; top: number; width: number; height: number };
  resize?: { width: number; height: number };
}

export async function renderVideoEdit(
  bytes: Buffer,
  filename: string,
  edit: VideoEditRange,
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'b88-video-edit-'));
  try {
    const input = path.join(dir, `source${path.extname(filename) || '.mp4'}`);
    const output = path.join(dir, 'output.mp4');
    await writeFile(input, bytes);
    await run('ffmpeg', buildVideoEditArgs(input, output, edit), {
      timeout: env.RENDER_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 8 * 1024 * 1024,
    });
    return readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function renderAudioTrim(
  bytes: Buffer,
  startSeconds: number,
  endSeconds: number,
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'b88-audio-edit-'));
  try {
    const input = path.join(dir, 'source.bin');
    const output = path.join(dir, 'output.m4a');
    await writeFile(input, bytes);
    await run('ffmpeg', buildAudioTrimArgs(input, output, startSeconds, endSeconds), {
        timeout: env.RENDER_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    return readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function buildVideoEditArgs(
  input: string,
  output: string,
  edit: VideoEditRange,
): string[] {
  const filters: string[] = [];
  if (edit.crop) {
    const { width, height, left, top } = edit.crop;
    filters.push(`crop=${width}:${height}:${left}:${top}`);
  }
  if (edit.resize) filters.push(`scale=${edit.resize.width}:${edit.resize.height}`);
  const start = Math.max(0, edit.startSeconds ?? 0);
  if (edit.endSeconds != null) {
    filters.unshift(
      `trim=start=${start.toFixed(6)}:end=${edit.endSeconds.toFixed(6)}`,
      'setpts=PTS-STARTPTS',
    );
  } else if (start > 0) {
    filters.unshift(`trim=start=${start.toFixed(6)}`, 'setpts=PTS-STARTPTS');
  }
  return [
    '-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', input,
    ...(filters.length ? ['-vf', filters.join(',')] : []),
    '-af',
    edit.endSeconds != null
      ? `atrim=start=${start.toFixed(6)}:end=${edit.endSeconds.toFixed(6)},asetpts=PTS-STARTPTS`
      : `atrim=start=${start.toFixed(6)},asetpts=PTS-STARTPTS`,
    '-map', '0:v:0', '-map', '0:a?',
    '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', output,
  ];
}

export function buildAudioTrimArgs(
  input: string,
  output: string,
  startSeconds: number,
  endSeconds: number,
): string[] {
  return [
    '-hide_banner', '-nostdin', '-v', 'error', '-y',
    '-i', input,
    '-af',
    `atrim=start=${startSeconds.toFixed(6)}:end=${endSeconds.toFixed(6)},asetpts=PTS-STARTPTS`,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-fflags', '+bitexact', '-flags', '+bitexact', '-map_metadata', '-1',
    output,
  ];
}
