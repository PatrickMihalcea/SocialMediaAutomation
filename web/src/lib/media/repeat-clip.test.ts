import { describe, expect, it } from 'vitest';
import { repeatArgs } from '@/lib/media/repeat-clip';

describe('playing a clip several times', () => {
  it('loops the input the extra times and copies the streams', () => {
    expect(repeatArgs('in.mp4', 'out.mp4', 4)).toEqual(
      ['-v', 'error', '-y', '-stream_loop', '3', '-i', 'in.mp4', '-c', 'copy', '-movflags', '+faststart', 'out.mp4'],
    );
  });
});
