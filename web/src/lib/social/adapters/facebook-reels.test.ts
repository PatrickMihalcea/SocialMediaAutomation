import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platformJson = vi.hoisted(() => vi.fn());

vi.mock('server-only', () => ({}));
vi.mock('@/lib/social/http', () => ({ platformJson }));

import { canBeReel, FacebookAdapter, reelFailure } from '@/lib/social/adapters/facebook';
import type { OutgoingMedia, PublishContext } from '@/lib/social/types';

const video = (overrides: Partial<OutgoingMedia> = {}): OutgoingMedia => ({
  id: 'asset-1',
  type: 'VIDEO',
  mimeType: 'video/mp4',
  filename: 'reel.mp4',
  size: 1_000_000,
  width: 1080,
  height: 1920,
  durationSeconds: 30,
  altText: null,
  url: 'https://storage.example/reel.mp4?signed',
  read: async () => Buffer.from(''),
  ...overrides,
});

const context = (media: OutgoingMedia): PublishContext => ({
  account: { externalAccountId: 'page-1', accessToken: 'page-token' } as PublishContext['account'],
  post: { text: 'Wet leaves on the cul-de-sac', media: [media], hashtags: [], mentions: [] },
  idempotencyKey: 'key-1',
});

/** The calls the adapter made, by URL and method, in order. */
const calls = () => platformJson.mock.calls.map(([req]) => req as {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
});

/**
 * Every Facebook video used to go out as a plain Page video, which Facebook
 * shows to the Page's followers and almost nobody else. For a new Page that is
 * invisible. Reels are what reach people who do not follow you.
 */
describe('publishing a video to Facebook', () => {
  beforeEach(() => platformJson.mockReset());

  it('publishes a vertical short as a Reel, in Meta\'s three steps', async () => {
    platformJson
      .mockResolvedValueOnce({ video_id: 'reel-9' })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ status: { video_status: 'ready', publishing_phase: { status: 'complete' } } });

    const result = await new FacebookAdapter().publishVideoPost(context(video()));

    const [start, upload, finish] = calls();
    expect(start.url).toMatch(/\/page-1\/video_reels$/);
    expect(start.body).toContain('upload_phase=start');

    // Facebook fetches the file itself, from our signed URL.
    expect(upload.url).toMatch(/^https:\/\/rupload\.facebook\.com\/video-upload\/v[\d.]+\/reel-9$/);
    expect(upload.headers).toMatchObject({ authorization: 'OAuth page-token', file_url: 'https://storage.example/reel.mp4?signed' });

    expect(finish.url).toMatch(/\/page-1\/video_reels$/);
    const body = new URLSearchParams(finish.body);
    expect(body.get('upload_phase')).toBe('finish');
    expect(body.get('video_id')).toBe('reel-9');
    expect(body.get('video_state')).toBe('PUBLISHED');
    expect(body.get('description')).toContain('Wet leaves on the cul-de-sac');

    expect(result.platformPostId).toBe('reel-9');
    expect(result.url).toBe('https://www.facebook.com/reel/reel-9');
  });

  it('never touches the plain video endpoint for a Reel', async () => {
    platformJson
      .mockResolvedValueOnce({ video_id: 'reel-9' })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ status: { publishing_phase: { status: 'complete' } } });

    await new FacebookAdapter().publishVideoPost(context(video()));

    expect(calls().some((call) => /\/page-1\/videos$/.test(call.url))).toBe(false);
  });

  it('sends a landscape video out as a Page video, since Meta would refuse it as a Reel', async () => {
    platformJson.mockResolvedValueOnce({ id: 'video-3' });

    await new FacebookAdapter().publishVideoPost(context(video({ width: 1920, height: 1080 })));

    expect(calls()[0].url).toMatch(/\/page-1\/videos$/);
    expect(calls().some((call) => call.url.includes('video_reels'))).toBe(false);
  });

  it('fails with Meta\'s own reason when it refuses the Reel during processing', async () => {
    platformJson
      .mockResolvedValueOnce({ video_id: 'reel-9' })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({
        status: { video_status: 'error', processing_phase: { status: 'error', errors: [{ message: 'Video is too short' }] } },
      });

    await expect(new FacebookAdapter().publishVideoPost(context(video())))
      .rejects.toThrow('Facebook refused this Reel: Video is too short');
  });

  describe('when processing outlasts the wait', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout'] }));
    afterEach(() => vi.useRealTimers());

    /**
     * Once the publish call is accepted the Reel goes live on its own. Failing
     * here would make the step retry and upload it a second time.
     */
    it('reports it published rather than failing into a duplicate', async () => {
      platformJson
        .mockResolvedValueOnce({ video_id: 'reel-9' })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValue({ status: { video_status: 'processing', publishing_phase: { status: 'not_started' } } });

      const publishing = new FacebookAdapter().publishVideoPost(context(video()));
      await vi.runAllTimersAsync();

      await expect(publishing).resolves.toMatchObject({ platformPostId: 'reel-9' });
    });
  });
});

describe('canBeReel', () => {
  it('takes what this app renders: a 1080x1920 short', () => {
    expect(canBeReel({ width: 1080, height: 1920, durationSeconds: 30 })).toBe(true);
  });

  it.each([
    ['landscape', { width: 1920, height: 1080, durationSeconds: 30 }],
    ['square', { width: 1080, height: 1080, durationSeconds: 30 }],
    ['too short', { width: 1080, height: 1920, durationSeconds: 2 }],
    ['too long', { width: 1080, height: 1920, durationSeconds: 120 }],
    ['too small', { width: 480, height: 854, durationSeconds: 30 }],
  ])('refuses a %s video', (_, media) => {
    expect(canBeReel(media)).toBe(false);
  });

  it('tries a Reel when nothing is known about the file', () => {
    expect(canBeReel({ width: null, height: null, durationSeconds: null })).toBe(true);
  });
});

describe('reelFailure', () => {
  it('is null while the Reel is still on its way', () => {
    expect(reelFailure({ video_status: 'processing', processing_phase: { status: 'in_progress' } })).toBeNull();
    expect(reelFailure(undefined)).toBeNull();
  });

  it('names the phase error Meta gave', () => {
    expect(reelFailure({ publishing_phase: { status: 'error', errors: [{ message: 'Page cannot publish Reels' }] } }))
      .toBe('Page cannot publish Reels');
  });
});
