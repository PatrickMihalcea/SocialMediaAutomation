import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The clip played `times` times end to end, as one file.
 *
 * The streams are copied, not re-encoded, so every repeat is the same picture
 * at the same quality. A clip made as a seamless loop then plays as one long
 * continuous one. Falls back to the clip as it was if ffmpeg fails.
 */
export async function repeatClip(video: Buffer, times: number): Promise<Buffer> {
  if (times <= 1) return video;
  const dir = await mkdtemp(path.join(tmpdir(), 'b88-repeat-'));
  const input = path.join(dir, 'in.mp4');
  const output = path.join(dir, 'out.mp4');
  try {
    await writeFile(input, video);
    await run('ffmpeg', repeatArgs(input, output, times));
    return await readFile(output);
  } catch (error) {
    console.warn('[media] could not repeat the clip; keeping one play', error);
    return video;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The ffmpeg arguments. Exported for its test. */
export function repeatArgs(input: string, output: string, times: number): string[] {
  return ['-v', 'error', '-y', '-stream_loop', String(times - 1), '-i', input, '-c', 'copy', '-movflags', '+faststart', output];
}
