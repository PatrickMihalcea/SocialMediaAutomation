import { describe, expect, it } from 'vitest';
import { MockAdapter } from './adapters/mock';
import { Platform } from '@prisma/client';
import type { OutgoingPost } from './types';

const base: OutgoingPost = {
  text: 'A short post',
  hashtags: [],
  mentions: [],
  media: [],
};

describe('platform validation', () => {
  it('enforces the X character limit', () => {
    const adapter = new MockAdapter(Platform.X);
    const issues = adapter.validatePost({ ...base, text: 'a'.repeat(281) });
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'TEXT_TOO_LONG', severity: 'error' }),
    );
  });

  it('requires media for Instagram', () => {
    const adapter = new MockAdapter(Platform.INSTAGRAM);
    const issues = adapter.validatePost(base);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'MEDIA_REQUIRED' }));
  });

  it('rejects a video beyond the platform duration limit', () => {
    const adapter = new MockAdapter(Platform.X);
    const issues = adapter.validatePost({
      ...base,
      media: [{
        id: 'video',
        type: 'VIDEO',
        mimeType: 'video/mp4',
        filename: 'cut.mp4',
        size: 1024,
        width: 1080,
        height: 1920,
        durationSeconds: 141,
        altText: null,
        url: '',
        read: async () => Buffer.alloc(0),
      }],
    });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'VIDEO_TOO_LONG' }));
  });
});
