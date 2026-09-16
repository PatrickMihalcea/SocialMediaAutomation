import { Platform } from '@prisma/client';
import { BaseAdapter, composeText } from '@/lib/social/base';
import { CAPABILITIES } from '@/lib/social/capabilities';
import { env } from '@/lib/env';
import { platformFetch, platformJson } from '@/lib/social/http';
import { notConfigured, PlatformError } from '@/lib/social/errors';
import type {
  AccountMetrics,
  AuthorizationRequest,
  ConnectionResult,
  DecryptedAccount,
  PlatformPostStatus,
  PlatformProfile,
  PostMetrics,
  PublishContext,
  PublishResult,
  RefreshedToken,
} from '@/lib/social/types';

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';

/**
 * YouTube Data API v3.
 *
 * Uploads use the resumable protocol: POST the metadata to get a session URL,
 * then PUT the bytes to it. Google's own dedupe is weak here, so the engine's
 * idempotency check (does a post with this key already exist upstream) is what
 * keeps a retry from producing two videos.
 *
 * INTEGRATION BOUNDARY — unaudited projects can only upload private videos and
 * have a very small daily quota.
 */
export class YouTubeAdapter extends BaseAdapter {
  readonly platform = Platform.YOUTUBE;
  readonly capabilities = CAPABILITIES.YOUTUBE;

  private readonly scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ];

  isConfigured(): boolean {
    return Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET);
  }

  async getAuthorizationUrl(input: { redirectUri: string; state: string }): Promise<AuthorizationRequest> {
    if (!this.isConfigured()) throw notConfigured(this.platform);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', env.YOUTUBE_CLIENT_ID);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.scopes.join(' '));
    url.searchParams.set('state', input.state);
    // Offline + consent is what actually returns a refresh token on re-consent.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    return { url: url.toString() };
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<ConnectionResult[]> {
    if (!this.isConfigured()) throw notConfigured(this.platform);
    const token = await platformJson<{ access_token: string; refresh_token?: string; expires_in: number }>({
      platform: this.platform,
      method: 'POST',
      url: 'https://oauth2.googleapis.com/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        client_id: env.YOUTUBE_CLIENT_ID,
        client_secret: env.YOUTUBE_CLIENT_SECRET,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const channels = await platformJson<{
      items?: {
        id: string;
        snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
        statistics?: { subscriberCount?: string };
      }[];
    }>({
      platform: this.platform,
      url: `${API}/channels?part=snippet,statistics&mine=true`,
      headers: { authorization: `Bearer ${token.access_token}` },
    });

    const items = channels.items ?? [];
    if (items.length === 0) {
      throw new PlatformError({
        platform: this.platform,
        code: 'NO_ACCOUNT',
        message: 'That Google account has no YouTube channel. Create one, then connect again.',
      });
    }

    return items.map((channel) => ({
      externalAccountId: channel.id,
      accountName: channel.snippet?.title ?? 'YouTube channel',
      accountHandle: channel.snippet?.customUrl,
      avatarUrl: channel.snippet?.thumbnails?.default?.url,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: this.scopes,
      metadata: { channelId: channel.id },
    }));
  }

  async refreshToken(account: DecryptedAccount): Promise<RefreshedToken | null> {
    if (!account.refreshToken || !this.isConfigured()) return null;
    const token = await platformJson<{ access_token: string; expires_in: number }>({
      platform: this.platform,
      method: 'POST',
      url: 'https://oauth2.googleapis.com/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.YOUTUBE_CLIENT_ID,
        client_secret: env.YOUTUBE_CLIENT_SECRET,
        refresh_token: account.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    return {
      accessToken: token.access_token,
      // Google keeps the same refresh token across refreshes.
      refreshToken: account.refreshToken,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
    };
  }

  async disconnect(account: DecryptedAccount): Promise<void> {
    const token = account.refreshToken ?? this.requireToken(account);
    await platformFetch({
      platform: this.platform,
      method: 'POST',
      url: `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  }

  async getAccount(account: DecryptedAccount): Promise<PlatformProfile> {
    const token = this.requireToken(account);
    const res = await platformJson<{
      items?: {
        id: string;
        snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
        statistics?: { subscriberCount?: string; viewCount?: string };
      }[];
    }>({
      platform: this.platform,
      url: `${API}/channels?part=snippet,statistics&id=${account.externalAccountId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const channel = res.items?.[0];
    return {
      externalAccountId: account.externalAccountId,
      accountName: channel?.snippet?.title ?? account.accountName,
      accountHandle: channel?.snippet?.customUrl,
      avatarUrl: channel?.snippet?.thumbnails?.default?.url,
      followers: channel?.statistics?.subscriberCount ? Number(channel.statistics.subscriberCount) : undefined,
    };
  }

  async publishTextPost(): Promise<PublishResult> {
    throw new PlatformError({
      platform: this.platform,
      code: 'MEDIA_REQUIRED',
      message: 'YouTube posts need a video.',
    });
  }

  async publishMediaPost(ctx: PublishContext): Promise<PublishResult> {
    return this.publishVideoPost(ctx);
  }

  async publishVideoPost(ctx: PublishContext): Promise<PublishResult> {
    const token = this.requireToken(ctx.account);
    const video = ctx.post.media.find((m) => m.type === 'VIDEO');
    if (!video) {
      throw new PlatformError({
        platform: this.platform,
        code: 'MEDIA_REQUIRED',
        message: 'YouTube posts need a video.',
      });
    }

    const metadata = {
      snippet: {
        title: (ctx.post.title || ctx.post.text.split('\n')[0] || video.filename).slice(0, 100),
        description: composeText(ctx.post).slice(0, this.capabilities.maxTextLength),
        tags: ctx.post.hashtags.map((h) => h.replace(/^#/, '')).slice(0, 30),
      },
      status: { privacyStatus: env.YOUTUBE_PRIVACY_STATUS, selfDeclaredMadeForKids: false },
    };

    // Step 1 — open a resumable session.
    const session = await platformFetch({
      platform: this.platform,
      method: 'POST',
      url: `${UPLOAD}?uploadType=resumable&part=snippet,status`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'X-Upload-Content-Type': video.mimeType,
        'X-Upload-Content-Length': String(video.size),
      },
      body: JSON.stringify(metadata),
    });
    const location = session.headers.get('location');
    if (!location) {
      throw new PlatformError({
        platform: this.platform,
        code: 'UPLOAD_INIT',
        retryable: true,
        message: 'YouTube did not open an upload session. Bridge88 will try again.',
      });
    }

    // Step 2 — send the bytes.
    const bytes = await video.read();
    const result = await platformJson<{ id: string }>({
      platform: this.platform,
      method: 'PUT',
      url: location,
      headers: { authorization: `Bearer ${token}`, 'content-type': video.mimeType },
      body: new Uint8Array(bytes),
      timeoutMs: 600_000,
    });

    if (ctx.post.firstComment) {
      await platformJson({
        platform: this.platform,
        method: 'POST',
        url: `${API}/commentThreads?part=snippet`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          snippet: {
            videoId: result.id,
            topLevelComment: { snippet: { textOriginal: ctx.post.firstComment } },
          },
        }),
      }).catch((e) => console.error('[youtube] first comment failed', e));
    }

    return {
      platformPostId: result.id,
      url: `https://www.youtube.com/watch?v=${result.id}`,
      publishedAt: new Date(),
    };
  }

  async getPost(account: DecryptedAccount, platformPostId: string): Promise<PlatformPostStatus> {
    const token = this.requireToken(account);
    const res = await platformJson<{ items?: { id: string; snippet?: { publishedAt?: string } }[] }>({
      platform: this.platform,
      url: `${API}/videos?part=snippet&id=${platformPostId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const video = res.items?.[0];
    if (!video) return { platformPostId, exists: false };
    return {
      platformPostId,
      exists: true,
      url: `https://www.youtube.com/watch?v=${platformPostId}`,
      publishedAt: video.snippet?.publishedAt ? new Date(video.snippet.publishedAt) : undefined,
    };
  }

  async deletePost(account: DecryptedAccount, platformPostId: string): Promise<void> {
    const token = this.requireToken(account);
    await platformFetch({
      platform: this.platform,
      method: 'DELETE',
      url: `${API}/videos?id=${platformPostId}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async getPostAnalytics(account: DecryptedAccount, platformPostId: string): Promise<PostMetrics> {
    const token = this.requireToken(account);
    const res = await platformJson<{
      items?: {
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      }[];
    }>({
      platform: this.platform,
      url: `${API}/videos?part=statistics&id=${platformPostId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const stats = res.items?.[0]?.statistics;
    const n = (v?: string) => (v == null ? null : Number(v));
    return {
      videoViews: n(stats?.viewCount),
      impressions: n(stats?.viewCount),
      likes: n(stats?.likeCount),
      comments: n(stats?.commentCount),
      // Shares, reach, saves and clicks need the YouTube Analytics API and a
      // channel-owner grant; the Data API does not expose them.
      shares: null,
      reach: null,
      saves: null,
      clicks: null,
      raw: res as Record<string, unknown>,
    };
  }

  async getAccountAnalytics(account: DecryptedAccount): Promise<AccountMetrics> {
    const profile = await this.getAccount(account);
    return { followers: profile.followers ?? null };
  }
}
