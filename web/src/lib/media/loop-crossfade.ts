import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Joins a clip's end to its own start with a dissolve, so it loops without a
 * visible snap.
 *
 * The result starts `fade` seconds in and ends by dissolving into the clip's
 * opening, which is where it starts again: the last frame shown is the frame
 * the loop returns to. It comes out `fade` seconds shorter, which the caller
 * makes up by rendering that much extra. Sound, where there is any, is
 * crossfaded the same way. Falls back to the clip as it was if ffmpeg fails:
 * a small seam beats no clip.
 */
export async function loopCrossfade(video: Buffer, lengthSeconds: number, fade: number): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'b88-loop-'));
  const input = path.join(dir, 'in.mp4');
  const output = path.join(dir, 'out.mp4');
  try {
    await writeFile(input, video);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', input]);
    await run('ffmpeg', loopCrossfadeArgs(input, output, lengthSeconds, fade, stdout.trim().length > 0));
    return await readFile(output);
  } catch (error) {
    console.warn('[media] could not crossfade the loop; keeping the clip as it is', error);
    return video;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The ffmpeg arguments. Exported for its test. */
export function loopCrossfadeArgs(input: string, output: string, length: number, fade: number, withAudio: boolean): string[] {
  const f = fade.toFixed(4);
  const offset = (length - 2 * fade).toFixed(4);
  const graph = [
    `[0:v]split[va][vb]`,
    `[va]trim=start=${f},setpts=PTS-STARTPTS[body]`,
    `[vb]trim=end=${f},setpts=PTS-STARTPTS[head]`,
    `[body][head]xfade=transition=fade:duration=${f}:offset=${offset},format=yuv420p[v]`,
    ...(withAudio
      ? [
          `[0:a]asplit[aa][ab]`,
          `[aa]atrim=start=${f},asetpts=PTS-STARTPTS[abody]`,
          `[ab]atrim=end=${f},asetpts=PTS-STARTPTS[ahead]`,
          `[abody][ahead]acrossfade=d=${f}[a]`,
        ]
      : []),
  ].join(';');
  return [
    '-v', 'error', '-y', '-i', input,
    '-filter_complex', graph,
    '-map', '[v]', ...(withAudio ? ['-map', '[a]'] : []),
    '-c:v', 'libx264', '-crf', '16', '-preset', 'medium',
    ...(withAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []),
    '-movflags', '+faststart',
    output,
  ];
}
