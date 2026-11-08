import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { speedArgs } from '@/lib/workflows/nodes/video-speed';

const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('changing a video\'s speed', () => {
  it('retimes the picture and stretches the sound at the same pitch', () => {
    const args = speedArgs('in.mp4', 'out.mp4', 0.5, false);
    expect(arg(args, '-vf')).toBe('setpts=PTS/0.5');
    expect(arg(args, '-af')).toBe('atempo=0.5');
    // A clip with no sound track still renders.
    expect(args).toContain('0:a?');
  });

  it('halves twice for quarter speed, which atempo cannot do in one pass', () => {
    expect(arg(speedArgs('in.mp4', 'out.mp4', 0.25, false), '-af')).toBe('atempo=0.5,atempo=0.5');
  });

  it('interpolates frames only when slowing down with smooth motion on', () => {
    expect(arg(speedArgs('in.mp4', 'out.mp4', 0.75, true), '-vf')).toContain('minterpolate');
    expect(arg(speedArgs('in.mp4', 'out.mp4', 1.5, true), '-vf')).not.toContain('minterpolate');
  });
});
