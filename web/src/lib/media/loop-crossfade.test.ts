import { describe, expect, it } from 'vitest';
import { loopCrossfadeArgs } from '@/lib/media/loop-crossfade';

describe('joining a loop with a dissolve', () => {
  it('dissolves the end into the start, so the clip ends where the loop begins', () => {
    const args = loopCrossfadeArgs('in.mp4', 'out.mp4', 5.666, 0.6667, true);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('[va]trim=start=0.6667');
    expect(graph).toContain('[vb]trim=end=0.6667');
    // The dissolve starts one fade before the shortened body ends.
    expect(graph).toContain('xfade=transition=fade:duration=0.6667:offset=4.3326');
    expect(graph).toContain('acrossfade=d=0.6667');
  });

  it('leaves sound out of the graph for a silent clip', () => {
    const args = loopCrossfadeArgs('in.mp4', 'out.mp4', 5, 0.5, false);
    expect(args[args.indexOf('-filter_complex') + 1]).not.toContain('[0:a]');
    expect(args).not.toContain('[a]');
  });
});
