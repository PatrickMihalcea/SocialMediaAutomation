import { describe, expect, it } from 'vitest';
import { joinArgs } from '@/lib/media/clip-chain';

describe('joining two pieces of a long clip', () => {
  it('dissolves across the frames they share', () => {
    const args = joinArgs('a.mp4', 'b.mp4', 'out.mp4', 6.0417, 0.375, false);
    const graph = args[args.indexOf('-filter_complex') + 1];
    // The dissolve starts one overlap before the first piece ends.
    expect(graph).toBe('[0:v][1:v]xfade=transition=fade:duration=0.3750:offset=5.6667,format=yuv420p[v]');
  });

  it('crossfades the sound too when both pieces have it', () => {
    const args = joinArgs('a.mp4', 'b.mp4', 'out.mp4', 3, 0.375, true);
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('acrossfade=d=0.3750');
    expect(args).toContain('[a]');
  });
});
