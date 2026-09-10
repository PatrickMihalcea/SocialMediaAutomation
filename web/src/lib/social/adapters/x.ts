import { createHash, randomBytes } from 'node:crypto';
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
  OutgoingMedia,
  PlatformPostStatus,
  PlatformProfile,
  PostMetrics,
  PublishContext,
  PublishResult,
  RefreshedToken,
} from '@/lib/social/types';

const API = 'https://api.x.com';
const UPLOAD = 'https://upload.x.com/1.1/media/upload.json';

/**
 * X (Twitter) API v2 with OAuth 2.0 PKCE.
 *
 * A first comment is posted as a reply in the same thread, which is how X models
 * the "first comment" idea other networks have natively.
 *
 * INTEGRATION BOUNDARY — write access requires a paid API tier.
 */
export class XAdapter extends BaseAdapter {
  readonly platform = Platform.X;
  readonly capabilities = CAPABILITIES.X;

  private readonly scopes = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'];

  isConfigured(): boolean {
    return Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET);
  }

  async getAuthorizationUrl(input: { redirectUri: string; state: string }): Promise<AuthorizationRequest> {
    if (!this.isConfigured()) throw notConfigured(this.platform);
    const codeVerifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const url = new URL('https://x.com/i/oauth2/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', env.X_CLIENT_ID);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', this.scopes.join(' '));
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString(), codeVerifier };
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<ConnectionResult[]> {
    if (!this.isConfigured()) throw notConfigured(this.platform);
    if (!input.codeVerifier) {
      throw new PlatformError({
        platform: this.platform,
        code: 'PKCE_MISSING',
        message: 'That connection attempt expired. Start connecting X again.',
      });
    }

    const token = await platformJson<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/2/oauth2/token`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      }).toString(),
    });

    const me = await platformJson<{ data: { id: string; name: string; username: string; profile_image_url?: string } }>({
      platform: this.platform,
      url: `${API}/2/users/me?user.fields=profile_image_url,public_metrics`,
      headers: { authorization: `Bearer ${token.access_token}` },
    });

    return [
      {
        externalAccountId: me.data.id,
        accountName: me.data.name,
        accountHandle: `@${me.data.username}`,
        avatarUrl: me.data.profile_image_url,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(Date.now() + token.expires_in * 1000),
        scopes: this.scopes,
        metadata: { username: me.data.username },
      },
    ];
  }

  async refreshToken(account: DecryptedAccount): Promise<RefreshedToken | null> {
    if (!account.refreshToken || !this.isConfigured()) return null;
    const token = await platformJson<{ access_token: string; refresh_token?: string; expires_in: number }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/2/oauth2/token`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
      }).toString(),
    });
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? account.refreshToken,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
    };
  }

  async disconnect(account: DecryptedAccount): Promise<void> {
    const token = account.refreshToken ?? this.requireToken(account);
    await platformJson({
      platform: this.platform,
      method: 'POST',
      url: `${API}/2/oauth2/revoke`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({ token, token_type_hint: account.refreshToken ? 'refresh_token' : 'access_token' }).toString(),
    });
  }

  async getAccount(account: DecryptedAccount): Promise<PlatformProfile> {
    const token = this.requireToken(account);
    const me = await platformJson<{
      data: {
        id: string;
        name: string;
        username: string;
        profile_image_url?: string;
        public_metrics?: { followers_count?: number; following_count?: number };
      };
    }>({
      platform: this.platform,
      url: `${API}/2/users/me?user.fields=profile_image_url,public_metrics`,
      headers: { authorization: `Bearer ${token}` },
    });
    return {
      externalAccountId: me.data.id,
      accountName: me.data.name,
      accountHandle: `@${me.data.username}`,
      avatarUrl: me.data.profile_image_url,
      followers: me.data.public_metrics?.followers_count,
      following: me.data.public_metrics?.following_count,
    };
  }

  async publishTextPost(ctx: PublishContext): Promise<PublishResult> {
    return this.createPost(ctx, []);
  }

  async publishMediaPost(ctx: PublishContext): Promise<PublishResult> {
    const token = this.requireToken(ctx.account);
    const ids: string[] = [];
    for (const item of ctx.post.media) ids.push(await this.uploadMedia(token, item));
    return this.createPost(ctx, ids);
  }

  async publishVideoPost(ctx: PublishContext): Promise<PublishResult> {
    return this.publishMediaPost(ctx);
  }

  /** Chunked upload: INIT, APPEND each 4 MB chunk, FINALIZE, then wait if async. */
  private async uploadMedia(token: string, item: OutgoingMedia): Promise<string> {
    const isVideo = item.type === 'VIDEO';
    const init = await platformJson<{ media_id_string: string }>({
      platform: this.platform,
      method: 'POST',
      url: UPLOAD,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        command: 'INIT',
        total_bytes: String(item.size),
        media_type: item.mimeType,
        media_category: isVideo ? 'tweet_video' : 'tweet_image',
      }).toString(),
    });
    const mediaId = init.media_id_string;

    const bytes = await item.read();
    const chunkSize = 4 * 1024 * 1024;
    for (let i = 0, segment = 0; i < bytes.length; i += chunkSize, segment++) {
      const form = new FormData();
      form.set('command', 'APPEND');
      form.set('media_id', mediaId);
      form.set('segment_index', String(segment));
      form.set('media', new Blob([new Uint8Array(bytes.subarray(i, i + chunkSize))]));
      await platformFetch({
        platform: this.platform,
        method: 'POST',
        url: UPLOAD,
        headers: { authorization: `Bearer ${token}` },
        body: form,
        timeoutMs: 120_000,
      });
    }

    const finalize = await platformJson<{
      processing_info?: { state: string; check_after_secs?: number; error?: { message?: string } };
    }>({
      platform: this.platform,
      method: 'POST',
      url: UPLOAD,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ command: 'FINALIZE', media_id: mediaId }).toString(),
    });

    if (finalize.processing_info) await this.waitForProcessing(token, mediaId);

    if (item.altText) {
      await platformJson({
        platform: this.platform,
        method: 'POST',
        url: 'https://api.x.com/1.1/media/metadata/create.json',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ media_id: mediaId, alt_text: { text: item.altText.slice(0, 1000) } }),
      }).catch((e) => console.error('[x] alt text failed', e));
    }
    return mediaId;
  }

  private async waitForProcessing(token: string, mediaId: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const status = await platformJson<{
        processing_info?: { state: string; check_after_secs?: number; error?: { message?: string } };
      }>({
        platform: this.platform,
        url: `${UPLOAD}?command=STATUS&media_id=${mediaId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      const info = status.processing_info;
      if (!info || info.state === 'succeeded') return;
      if (info.state === 'failed') {
        throw new PlatformError({
          platform: this.platform,
          code: 'MEDIA_REJECTED',
          message: info.error?.message ?? 'X could not process this video. Try a different file.',
        });
      }
      await new Promise((r) => setTimeout(r, (info.check_after_secs ?? 3) * 1000));
    }
    throw new PlatformError({
      platform: this.platform,
      code: 'TIMEOUT',
      retryable: true,
      message: 'X is still processing the video. Bridge88 will try again.',
    });
  }

  private async createPost(ctx: PublishContext, mediaIds: string[]): Promise<PublishResult> {
    const token = this.requireToken(ctx.account);
    const body: Record<string, unknown> = { text: composeText(ctx.post) };
    if (mediaIds.length) body.media = { media_ids: mediaIds };

    const res = await platformJson<{ data: { id: string } }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/2/tweets`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 45_000,
    });

    if (ctx.post.firstComment) {
      await platformJson({
        platform: this.platform,
        method: 'POST',
        url: `${API}/2/tweets`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          text: ctx.post.firstComment,
          reply: { in_reply_to_tweet_id: res.data.id },
        }),
      }).catch((e) => console.error('[x] reply failed', e));
    }

    const handle = (ctx.account.metadata.username as string) ?? 'i';
    return {
      platformPostId: res.data.id,
      url: `https://x.com/${handle}/status/${res.data.id}`,
      publishedAt: new Date(),
    };
  }

  async getPost(account: DecryptedAccount, platformPostId: string): Promise<PlatformPostStatus> {
    const token = this.requireToken(account);
    const res = await platformJson<{ data?: { id: string; created_at?: string } }>({
      platform: this.platform,
      url: `${API}/2/tweets/${platformPostId}?tweet.fields=created_at`,
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.data) return { platformPostId, exists: false };
    return {
      platformPostId,
      exists: true,
      publishedAt: res.data.created_at ? new Date(res.data.created_at) : undefined,
    };
  }

  async deletePost(account: DecryptedAccount, platformPostId: string): Promise<void> {
    const token = this.requireToken(account);
    await platformJson({
      platform: this.platform,
      method: 'DELETE',
      url: `${API}/2/tweets/${platformPostId}`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async getPostAnalytics(account: DecryptedAccount, platformPostId: string): Promise<PostMetrics> {
    const token = this.requireToken(account);
    const res = await platformJson<{
      data?: {
        public_metrics?: {
          impression_count?: number;
          like_count?: number;
          reply_count?: number;
          retweet_count?: number;
          quote_count?: number;
        };
        non_public_metrics?: { impression_count?: number; user_profile_clicks?: number };
        organic_metrics?: { impression_count?: number; url_link_clicks?: number };
      };
    }>({
      platform: this.platform,
      url: `${API}/2/tweets/${platformPostId}?tweet.fields=public_metrics,non_public_metrics,organic_metrics`,
      headers: { authorization: `Bearer ${token}` },
    });
    const pm = res.data?.public_metrics;
    return {
      impressions:
        res.data?.organic_metrics?.impression_count ??
        res.data?.non_public_metrics?.impression_count ??
        pm?.impression_count ??
        null,
      likes: pm?.like_count ?? null,
      comments: pm?.reply_count ?? null,
      shares: (pm?.retweet_count ?? 0) + (pm?.quote_count ?? 0) || null,
      clicks: res.data?.organic_metrics?.url_link_clicks ?? null,
      // X reports no unique reach or saves.
      reach: null,
      saves: null,
      raw: res as Record<string, unknown>,
    };
  }

  async getAccountAnalytics(account: DecryptedAccount): Promise<AccountMetrics> {
    const profile = await this.getAccount(account);
    return { followers: profile.followers ?? null, following: profile.following ?? null };
  }
}
