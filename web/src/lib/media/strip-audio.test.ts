import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withoutAudio } from '@/lib/media/strip-audio';

const run = promisify(execFile);
let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'strip-audio-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function streams(video: Buffer): Promise<string[]> {
  const file = path.join(dir, `probe-${Math.random()}.mp4`);
  await writeFile(file, video);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]);
  return stdout.trim().split('\n');
}

describe('removing a clip\'s sound', () => {
  it('keeps the picture and drops the audio track', async () => {
    const source = path.join(dir, 'with-sound.mp4');
    await run('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=1:rate=24:size=160x120',
      '-f', 'lavfi', '-i', 'sine=duration=1',
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', source,
    ]);
    const original = await readFile(source);
    expect(await streams(original)).toEqual(['video', 'audio']);

    expect(await streams(await withoutAudio(original, 'mp4'))).toEqual(['video']);
  });

  it('hands back the original when the file cannot be read', async () => {
    const junk = Buffer.from('not a video');
    expect(await withoutAudio(junk, 'mp4')).toBe(junk);
  });
});
