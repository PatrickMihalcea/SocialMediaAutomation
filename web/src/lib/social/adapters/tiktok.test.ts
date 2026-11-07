import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformJson = vi.hoisted(() => vi.fn());
const platformFetch = vi.hoisted(() => vi.fn());

vi.mock('server-only', () => ({}));
vi.mock('@/lib/social/http', () => ({ platformJson, platformFetch }));

import { TikTokAdapter, uploadChunks } from '@/lib/social/adapters/tiktok';
import { emptyTikTokOptions, tiktokOptionsProblem, type TikTokPostOptions } from '@/lib/social/tiktok-options';
import type { OutgoingMedia, PublishContext } from '@/lib/social/types';
import { PlatformError } from '@/lib/social/errors';

const bytes = Buffer.alloc(2_000, 1);

const video = (overrides: Partial<OutgoingMedia> = {}): OutgoingMedia => ({
  id: 'asset-1',
  type: 'VIDEO',
  mimeType: 'video/mp4',
  filename: 'clip.mp4',
  size: bytes.byteLength,
  width: 1080,
  height: 1920,
  durationSeconds: 12,
  altText: null,
  url: 'https://storage.example/clip.mp4?signed',
  read: async () => bytes,
  ...overrides,
});

const options = (overrides: Partial<TikTokPostOptions> = {}): TikTokPostOptions => ({
  ...emptyTikTokOptions(),
  privacyLevel: 'SELF_ONLY',
  ...overrides,
});

const context = (tiktok: TikTokPostOptions | null, media = video()): PublishContext => ({
  account: {
    accessToken: 'user-token',
    accountName: 'Dark Fantasy',
    metadata: { username: 'dark_fantasy' },
  } as unknown as PublishContext['account'],
  post: { text: 'The tower at dusk', media: [media], hashtags: [], mentions: [], tiktok },
  idempotencyKey: 'key-1',
});

const creatorInfo = (overrides: Record<string, unknown> = {}) => ({
  data: {
    creator_nickname: 'Dark Fantasy',
    creator_username: 'dark_fantasy',
    privacy_level_options: ['SELF_ONLY'],
    comment_disabled: false,
    duet_disabled: false,
    stitch_disabled: false,
    max_video_post_duration_sec: 600,
    ...overrides,
  },
  error: { code: 'ok' },
});

const jsonCalls = () => platformJson.mock.calls.map(([req]) => req as { url: string; body?: string });

describe('posting a video to TikTok', () => {
  beforeEach(() => {
    platformJson.mockReset();
    platformFetch.mockReset();
  });

  it('checks the account, uploads the file and posts with the settings chosen', async () => {
    platformJson
      .mockResolvedValueOnce(creatorInfo())
      .mockResolvedValueOnce({ data: { publish_id: 'pub-1', upload_url: 'https://upload.tiktok.example/1' } })
      .mockResolvedValueOnce({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['777'] } });

    const result = await new TikTokAdapter().publishVideoPost(context(options({ allowComment: true })));

    const [info, init] = jsonCalls();
    expect(info.url).toMatch(/\/post\/publish\/creator_info\/query\/$/);
    const body = JSON.parse(init.body!);
    expect(body.post_info).toMatchObject({
      privacy_level: 'SELF_ONLY',
      disable_comment: false,
      disable_duet: true,
      disable_stitch: true,
      brand_organic_toggle: false,
      brand_content_toggle: false,
    });
    // Uploaded, not pulled: our storage domain cannot be verified with TikTok.
    expect(body.source_info).toEqual({
      source: 'FILE_UPLOAD',
      video_size: bytes.byteLength,
      chunk_size: bytes.byteLength,
      total_chunk_count: 1,
    });

    const [upload] = platformFetch.mock.calls.map(([req]) => req);
    expect(upload).toMatchObject({ method: 'PUT', url: 'https://upload.tiktok.example/1' });
    expect(upload.headers['content-range']).toBe(`bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`);

    expect(result.platformPostId).toBe('777');
    expect(result.url).toBe('https://www.tiktok.com/@dark_fantasy/video/777');
  });

  it('refuses to post before someone has chosen who can see it', async () => {
    await expect(new TikTokAdapter().publishVideoPost(context(emptyTikTokOptions()))).rejects.toThrow(
      'Choose who can see this TikTok post.',
    );
    await expect(new TikTokAdapter().publishVideoPost(context(null))).rejects.toThrow(
      'Choose who can see this TikTok post.',
    );
    expect(platformJson).not.toHaveBeenCalled();
  });

  it('refuses a visibility the account no longer offers', async () => {
    platformJson.mockResolvedValueOnce(creatorInfo());

    await expect(
      new TikTokAdapter().publishVideoPost(context(options({ privacyLevel: 'PUBLIC_TO_EVERYONE' }))),
    ).rejects.toThrow('can no longer post with the visibility chosen');
  });

  it('keeps interactions off where the account has turned them off', async () => {
    platformJson
      .mockResolvedValueOnce(creatorInfo({ comment_disabled: true }))
      .mockResolvedValueOnce({ data: { publish_id: 'pub-1', upload_url: 'https://upload.tiktok.example/1' } })
      .mockResolvedValueOnce({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['777'] } });

    await new TikTokAdapter().publishVideoPost(context(options({ allowComment: true })));

    expect(JSON.parse(jsonCalls()[1].body!).post_info.disable_comment).toBe(true);
  });

  it("reports TikTok's own reason for a 403 instead of an expired login", async () => {
    platformJson.mockResolvedValueOnce(creatorInfo()).mockRejectedValueOnce(
      new PlatformError({
        platform: 'TIKTOK',
        code: 'AUTH',
        status: 403,
        needsReconnect: true,
        message: 'TikTok authorization expired. Reconnect TikTok to continue publishing.',
        detail: JSON.stringify({ error: { code: 'unaudited_client_can_only_post_to_private_accounts' } }),
      }),
    );

    const failure = await new TikTokAdapter().publishVideoPost(context(options())).catch((error) => error);

    expect(failure).toBeInstanceOf(PlatformError);
    expect(failure.code).toBe('unaudited_client_can_only_post_to_private_accounts');
    expect(failure.message).toMatch(/accounts set to Private/);
    // The login works; the channel must not be flagged for reconnection.
    expect(failure.needsReconnect).toBe(false);
  });

  it('refuses a video longer than the account may post', async () => {
    platformJson.mockResolvedValueOnce(creatorInfo({ max_video_post_duration_sec: 60 }));

    await expect(
      new TikTokAdapter().publishVideoPost(context(options(), video({ durationSeconds: 90 }))),
    ).rejects.toThrow('up to 60 seconds');
  });
});

describe('TikTok upload chunks', () => {
  it('sends a file up to 64 MB in one piece', () => {
    expect(uploadChunks(5_000_000)).toEqual({ chunkSize: 5_000_000, count: 1 });
  });

  it('splits a larger file into 10 MB pieces, the last taking the rest', () => {
    const size = 150 * 1024 * 1024 + 123;
    expect(uploadChunks(size)).toEqual({ chunkSize: 10 * 1024 * 1024, count: 15 });
  });
});

describe('TikTok post settings', () => {
  it('needs promotional content to say whose it is', () => {
    expect(tiktokOptionsProblem(options({ commercial: true }))).toMatch(/promotes yourself, a third party/);
    expect(tiktokOptionsProblem(options({ commercial: true, yourBrand: true }))).toBeNull();
  });

  it('does not allow branded content to be private', () => {
    expect(tiktokOptionsProblem(options({ commercial: true, brandedContent: true }))).toMatch(/cannot be set to private/);
  });
});
