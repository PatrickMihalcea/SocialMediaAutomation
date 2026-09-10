import { randomBytes, createHash } from 'node:crypto';
import { Platform } from '@prisma/client';
import { BaseAdapter, composeText } from '@/lib/social/base';
import { CAPABILITIES } from '@/lib/social/capabilities';
import { env } from '@/lib/env';
import { platformJson } from '@/lib/social/http';
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

const API = 'https://open.tiktokapis.com/v2';

/**
 * TikTok Content Posting API.
 *
 * TikTok pulls the file from a URL we supply, then reports progress against a
 * publish id — so a "successful" API call only means the upload was accepted.
 * The publish is confirmed by polling before the post is marked published.
 *
 * INTEGRATION BOUNDARY — unaudited apps can only post to private accounts;
 * public posting requires TikTok's audit.
 */
export class TikTokAdapter extends BaseAdapter {
  readonly platform = Platform.TIKTOK;
  readonly capabilities = CAPABILITIES.TIKTOK;

  private readonly scopes = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.publish', 'video.upload', 'video.list'];

  isConfigured(): boolean {
    return Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);
  }

  async getAuthorizationUrl(input: { redirectUri: string; state: string }): Promise<AuthorizationRequest> {
    if (!this.isConfigured()) throw notConfigured(this.platform);
    const codeVerifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
    url.searchParams.set('client_key', env.TIKTOK_CLIENT_KEY);
    url.searchParams.set('scope', this.scopes.join(','));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', input.redirectUri);
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
    const token = await platformJson<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      open_id: string;
      scope: string;
    }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/oauth/token/`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        code: input.code,
        grant_type: 'authorization_code',
        redirect_uri: input.redirectUri,
        ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
      }).toString(),
    });

    const profile = await this.fetchProfile(token.access_token);
    return [
      {
        externalAccountId: token.open_id,
        accountName: profile.display_name ?? 'TikTok account',
        accountHandle: profile.username ? `@${profile.username}` : undefined,
        avatarUrl: profile.avatar_url,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(Date.now() + token.expires_in * 1000),
        scopes: token.scope ? token.scope.split(',') : this.scopes,
        metadata: { openId: token.open_id, username: profile.username },
      },
    ];
  }

  async refreshToken(account: DecryptedAccount): Promise<RefreshedToken | null> {
    if (!account.refreshToken || !this.isConfigured()) return null;
    const token = await platformJson<{ access_token: string; refresh_token: string; expires_in: number }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/oauth/token/`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
      }).toString(),
    });
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
    };
  }

  async disconnect(account: DecryptedAccount): Promise<void> {
    const token = account.refreshToken ?? this.requireToken(account);
    await platformJson({
      platform: this.platform,
      method: 'POST',
      url: `${API}/oauth/revoke/`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        token,
      }).toString(),
    });
  }

  private async fetchProfile(token: string) {
    const res = await platformJson<{
      data?: { user?: { display_name?: string; username?: string; avatar_url?: string; follower_count?: number; following_count?: number } };
    }>({
      platform: this.platform,
      url: `${API}/user/info/?fields=open_id,display_name,username,avatar_url,follower_count,following_count`,
      headers: { authorization: `Bearer ${token}` },
    });
    return res.data?.user ?? {};
  }

  async getAccount(account: DecryptedAccount): Promise<PlatformProfile> {
    const user = await this.fetchProfile(this.requireToken(account));
    return {
      externalAccountId: account.externalAccountId,
      accountName: user.display_name ?? account.accountName,
      accountHandle: user.username ? `@${user.username}` : undefined,
      avatarUrl: user.avatar_url,
      followers: user.follower_count,
      following: user.following_count,
    };
  }

  async publishTextPost(): Promise<PublishResult> {
    throw new PlatformError({
      platform: this.platform,
      code: 'MEDIA_REQUIRED',
      message: 'TikTok posts need a video.',
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
        message: 'TikTok posts need a video.',
      });
    }

    const init = await platformJson<{ data?: { publish_id?: string }; error?: { code?: string; message?: string } }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/post/publish/video/init/`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        post_info: {
          title: composeText(ctx.post).slice(0, this.capabilities.maxTextLength),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
        },
        // PULL_FROM_URL avoids streaming the bytes through this server. The
        // domain must be verified in the TikTok developer console.
        source_info: { source: 'PULL_FROM_URL', video_url: video.url },
      }),
      timeoutMs: 60_000,
    });

    const publishId = init.data?.publish_id;
    if (!publishId) {
      throw new PlatformError({
        platform: this.platform,
        code: init.error?.code ?? 'REJECTED',
        message: init.error?.message ?? 'TikTok did not accept the video. Check the file and try again.',
        detail: JSON.stringify(init),
      });
    }

    const status = await this.pollPublish(token, publishId);
    return {
      platformPostId: status.postId ?? publishId,
      url: status.postId
        ? `https://www.tiktok.com/@${(ctx.account.metadata.username as string) ?? ''}/video/${status.postId}`
        : undefined,
      publishedAt: new Date(),
      raw: { publishId },
    };
  }

  private async pollPublish(token: string, publishId: string): Promise<{ postId?: string }> {
    for (let i = 0; i < 40; i++) {
      const res = await platformJson<{
        data?: { status?: string; publicaly_available_post_id?: string[]; fail_reason?: string };
      }>({
        platform: this.platform,
        method: 'POST',
        url: `${API}/post/publish/status/fetch/`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ publish_id: publishId }),
      });
      const status = res.data?.status;
      if (status === 'PUBLISH_COMPLETE') {
        return { postId: res.data?.publicaly_available_post_id?.[0] };
      }
      if (status === 'FAILED') {
        throw new PlatformError({
          platform: this.platform,
          code: 'PUBLISH_FAILED',
          message: `TikTok could not publish this video: ${res.data?.fail_reason ?? 'no reason given'}.`,
        });
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new PlatformError({
      platform: this.platform,
      code: 'TIMEOUT',
      retryable: true,
      message: 'TikTok is still processing the video. Bridge88 will check again.',
    });
  }

  async getPost(account: DecryptedAccount, platformPostId: string): Promise<PlatformPostStatus> {
    const token = this.requireToken(account);
    const res = await platformJson<{ data?: { videos?: { id: string; share_url?: string; create_time?: number }[] } }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/video/query/?fields=id,share_url,create_time`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ filters: { video_ids: [platformPostId] } }),
    });
    const video = res.data?.videos?.[0];
    if (!video) return { platformPostId, exists: false };
    return {
      platformPostId,
      exists: true,
      url: video.share_url,
      publishedAt: video.create_time ? new Date(video.create_time * 1000) : undefined,
    };
  }

  async getPostAnalytics(account: DecryptedAccount, platformPostId: string): Promise<PostMetrics> {
    const token = this.requireToken(account);
    const res = await platformJson<{
      data?: { videos?: { view_count?: number; like_count?: number; comment_count?: number; share_count?: number }[] };
    }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/video/query/?fields=id,view_count,like_count,comment_count,share_count`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ filters: { video_ids: [platformPostId] } }),
    });
    const v = res.data?.videos?.[0];
    return {
      impressions: v?.view_count ?? null,
      videoViews: v?.view_count ?? null,
      likes: v?.like_count ?? null,
      comments: v?.comment_count ?? null,
      shares: v?.share_count ?? null,
      // TikTok's public API reports no unique reach, saves or link clicks.
      reach: null,
      saves: null,
      clicks: null,
      raw: res as Record<string, unknown>,
    };
  }

  async getAccountAnalytics(account: DecryptedAccount): Promise<AccountMetrics> {
    const profile = await this.getAccount(account);
    return { followers: profile.followers ?? null, following: profile.following ?? null };
  }
}
