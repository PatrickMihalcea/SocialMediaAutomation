import { describe, expect, it } from 'vitest';
import { MediaType } from '@prisma/client';
import { MAX_MEDIA_BYTES, validateMediaUpload, validateMediaUploads } from '@/lib/media/validation';

describe('media upload validation', () => {
  it('accepts MP3 audio as an audio asset', () => {
    expect(validateMediaUpload({ name: 'voiceover.mp3', type: 'audio/mpeg', size: 1024 }))
      .toBe(MediaType.AUDIO);
  });

  it('rejects unsupported, empty, and oversized files', () => {
    expect(() => validateMediaUpload({ name: 'notes.txt', type: 'text/plain', size: 10 }))
      .toThrow('unsupported');
    expect(() => validateMediaUpload({ name: 'empty.png', type: 'image/png', size: 0 }))
      .toThrow('empty');
    expect(() => validateMediaUpload({ name: 'large.mp4', type: 'video/mp4', size: MAX_MEDIA_BYTES + 1 }))
      .toThrow('250 MB');
  });

  it('validates an entire upload batch before returning file types', () => {
    const files = [
      { name: 'first.png', type: 'image/png', size: 1024 },
      { name: 'bad.txt', type: 'text/plain', size: 12 },
    ];

    expect(() => validateMediaUploads(files)).toThrow('bad.txt has an unsupported file type');
  });
});
