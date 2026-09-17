import { describe, expect, it } from 'vitest';
import { filenameFromPrompt } from '@/lib/media/filename-from-prompt';

describe('filenameFromPrompt', () => {
  it('names the file after the subject, not the medium', () => {
    expect(filenameFromPrompt('A photo of a red bicycle leaning on a wall', 'png')).toBe(
      'red-bicycle-leaning-on-a-wall.png',
    );
  });

  it('keeps the words that carry the subject even when they repeat a noise word', () => {
    // "in the rain" is what distinguishes this from every other bicycle shot.
    expect(filenameFromPrompt('a red bicycle in the rain', 'png')).toBe('red-bicycle-in-the-rain.png');
  });

  it('drops punctuation and collapses whitespace', () => {
    expect(filenameFromPrompt('Neon  cityscape, at night!!', 'webp')).toBe('neon-cityscape-at-night.webp');
  });

  it('stays short enough to read in a list', () => {
    const name = filenameFromPrompt('a '.repeat(2) + 'word '.repeat(40), 'png');
    expect(name.length).toBeLessThanOrEqual(53);
  });

  /** A brief made entirely of framing words still has to produce a filename. */
  it('falls back rather than producing a bare extension', () => {
    expect(filenameFromPrompt('an image of', 'png')).toBe('an-image-of.png');
    expect(filenameFromPrompt('   ', 'png')).toBe('generated.png');
    expect(filenameFromPrompt('!!!', 'png', 'clip')).toBe('clip.png');
  });
});
