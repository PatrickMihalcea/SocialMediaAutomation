import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The same video with its audio track removed. The picture is copied, not
 * re-encoded, so nothing about it changes. Falls back to the original when
 * ffmpeg is missing or fails: a clip with sound beats no clip.
 */
export async function withoutAudio(video: Buffer, extension: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'b88-silent-'));
  const ext = extension.replace(/[^a-z0-9]/gi, '') || 'mp4';
  const input = path.join(dir, `in.${ext}`);
  const output = path.join(dir, `out.${ext}`);
  try {
    await writeFile(input, video);
    await run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-map', '0:v', '-c:v', 'copy', '-an', output]);
    return await readFile(output);
  } catch (error) {
    console.warn('[media] could not remove the audio track; keeping the clip as it is', error);
    return video;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
