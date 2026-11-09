import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Helpers for building one long clip out of short pieces, each continuing from
 * the last frames of the one before.
 */

/** How many frames a video has, counted from the stream itself. */
export async function frameCount(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file,
  ]);
  return Number(stdout.trim());
}

/**
 * The last `frames` frames of a video, as a short silent mp4 the next piece is
 * guided by. Encoded near-losslessly: these frames are copied into the next
 * piece, so any loss here would show at the join.
 */
export async function lastFrames(video: Buffer, frames: number, fps: number): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'b88-tail-'));
  try {
    const input = path.join(dir, 'in.mp4');
    const output = path.join(dir, 'tail.mp4');
    await writeFile(input, video);
    const total = await frameCount(input);
    await run('ffmpeg', [
      '-v', 'error', '-y', '-i', input,
      '-vf', `select='gte(n\\,${Math.max(0, total - frames)})',setpts=N/${fps}/TB`,
      '-an', '-r', String(fps), '-c:v', 'libx264', '-crf', '8', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      output,
    ]);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Two pieces joined over the frames they share.
 *
 * The next piece opens by redrawing the previous piece's last frames, so the
 * two overlap by exactly that much. A dissolve across the overlap hides the
 * small differences the redraw makes, and the length is the two together less
 * the overlap. Sound is crossfaded the same way when both pieces have it.
 */
export async function joinOverlapping(first: Buffer, next: Buffer, overlapSeconds: number): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'b88-join-'));
  try {
    const a = path.join(dir, 'a.mp4');
    const b = path.join(dir, 'b.mp4');
    const output = path.join(dir, 'joined.mp4');
    await writeFile(a, first);
    await writeFile(b, next);
    await run('ffmpeg', joinArgs(a, b, output, await duration(a), overlapSeconds, (await hasAudio(a)) && (await hasAudio(b))));
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The ffmpeg arguments for a join. Exported for its test. */
export function joinArgs(a: string, b: string, output: string, firstSeconds: number, overlap: number, withAudio: boolean): string[] {
  const offset = Math.max(0, firstSeconds - overlap).toFixed(4);
  const graph = [
    `[0:v][1:v]xfade=transition=fade:duration=${overlap.toFixed(4)}:offset=${offset},format=yuv420p[v]`,
    ...(withAudio ? [`[0:a][1:a]acrossfade=d=${overlap.toFixed(4)}[a]`] : []),
  ].join(';');
  return [
    '-v', 'error', '-y', '-i', a, '-i', b,
    '-filter_complex', graph,
    '-map', '[v]', ...(withAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []),
    '-c:v', 'libx264', '-crf', '14', '-preset', 'medium',
    '-movflags', '+faststart',
    output,
  ];
}

/** The video cut to an exact length, for a chain that rendered a little over. */
export async function trimTo(video: Buffer, seconds: number): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'b88-trim-'));
  try {
    const input = path.join(dir, 'in.mp4');
    const output = path.join(dir, 'out.mp4');
    await writeFile(input, video);
    await run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-t', seconds.toFixed(4), '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-c:a', 'aac', '-movflags', '+faststart', output]);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function duration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim());
}

async function hasAudio(file: string): Promise<boolean> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
  return stdout.trim().length > 0;
}
