import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { RENDER_TIMEOUT_MS: 30_000 } }));

import { buildAudioTrimArgs, buildVideoEditArgs } from '@/lib/media/ffmpeg-edit';

describe('FFmpeg media edit arguments', () => {
  it('uses filter-level timestamps for an audio range', () => {
    const args = buildAudioTrimArgs('source.mp3', 'trimmed.m4a', 1.25, 8.5);
    expect(args.join(' ')).toContain(
      'atrim=start=1.250000:end=8.500000,asetpts=PTS-STARTPTS',
    );
    expect(args).not.toContain('-ss');
  });

  it('trims video and optional audio to the same range', () => {
    const args = buildVideoEditArgs('source.mp4', 'trimmed.mp4', {
      startSeconds: 2,
      endSeconds: 7,
    });
    expect(args.join(' ')).toContain('trim=start=2.000000:end=7.000000,setpts=PTS-STARTPTS');
    expect(args.join(' ')).toContain('atrim=start=2.000000:end=7.000000,asetpts=PTS-STARTPTS');
    expect(args).toContain('0:a?');
  });
});
