import { randomBytes, createHash } from 'node:crypto';
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
  OutgoingPost,
  RefreshedToken,
  ValidationIssue,
} from '@/lib/social/types';
import {
  TIKTOK_PRIVACY_LEVELS,
  tiktokOptionsProblem,
  type TikTokCreatorInfo,
  type TikTokPrivacyLevel,
} from '@/lib/social/tiktok-options';

const API = 'https://open.tiktokapis.com/v2';

/**
 * TikTok Content Posting API.
 *
 * The video is uploaded to TikTok rather than pulled from a URL: pulling needs
 * the media domain verified with TikTok, and signed storage links live on a
 * domain we do not own. TikTok then reports progress against a publish id, so
 * a "successful" API call only means the upload was accepted; the publish is
 * confirmed by polling before the post is marked published.
 *
 * INTEGRATION BOUNDARY — until TikTok audits the app, creator_info offers only
 * "Only me", so every post is private.
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

  /**
   * What this creator can post right now. TikTok requires the composer to show
   * it before every post, and the answer changes: privacy options, disabled
   * interactions and the longest video allowed are all per account.
   */
  async getCreatorInfo(account: DecryptedAccount): Promise<TikTokCreatorInfo> {
    const res = await platformJson<{
      data?: {
        creator_nickname?: string;
        creator_username?: string;
        creator_avatar_url?: string;
        privacy_level_options?: string[];
        comment_disabled?: boolean;
        duet_disabled?: boolean;
        stitch_disabled?: boolean;
        max_video_post_duration_sec?: number;
      };
      error?: { code?: string; message?: string };
    }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/post/publish/creator_info/query/`,
      headers: { authorization: `Bearer ${this.requireToken(account)}`, 'content-type': 'application/json; charset=UTF-8' },
    });
    if (res.error?.code && res.error.code !== 'ok') {
      throw new PlatformError({
        platform: this.platform,
        code: res.error.code,
        message: creatorInfoMessage(res.error.code, res.error.message),
      });
    }
    const data = res.data ?? {};
    return {
      nickname: data.creator_nickname ?? account.accountName,
      username: data.creator_username ?? '',
      avatarUrl: data.creator_avatar_url ?? null,
      privacyLevels: (data.privacy_level_options ?? []).filter((level): level is TikTokPrivacyLevel =>
        (TIKTOK_PRIVACY_LEVELS as readonly string[]).includes(level),
      ),
      commentDisabled: Boolean(data.comment_disabled),
      duetDisabled: Boolean(data.duet_disabled),
      stitchDisabled: Boolean(data.stitch_disabled),
      maxVideoSeconds: data.max_video_post_duration_sec ?? null,
    };
  }

  validatePost(post: OutgoingPost): ValidationIssue[] {
    const issues = super.validatePost(post);
    const problem = tiktokOptionsProblem(post.tiktok);
    if (problem) issues.push({ severity: 'error', code: 'TIKTOK_SETTINGS', field: 'account', message: problem });
    return issues;
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

    const options = ctx.post.tiktok;
    const problem = tiktokOptionsProblem(options);
    if (problem || !options?.privacyLevel) {
      throw new PlatformError({ platform: this.platform, code: 'TIKTOK_SETTINGS', message: problem ?? 'Choose who can see this TikTok post.' });
    }

    // Checked again at publish time: a scheduled post can go out days after it
    // was composed, and the account may have changed in between.
    const creator = await this.getCreatorInfo(ctx.account);
    if (!creator.privacyLevels.includes(options.privacyLevel)) {
      throw new PlatformError({
        platform: this.platform,
        code: 'TIKTOK_PRIVACY',
        message: 'This TikTok account can no longer post with the visibility chosen. Pick another and try again.',
      });
    }
    if (creator.maxVideoSeconds && video.durationSeconds && video.durationSeconds > creator.maxVideoSeconds) {
      throw new PlatformError({
        platform: this.platform,
        code: 'VIDEO_TOO_LONG',
        message: `This TikTok account can post videos up to ${creator.maxVideoSeconds} seconds long.`,
      });
    }

    const bytes = await video.read();
    const chunks = uploadChunks(bytes.byteLength);
    const init = await platformJson<{
      data?: { publish_id?: string; upload_url?: string };
      error?: { code?: string; message?: string };
    }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/post/publish/video/init/`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        post_info: {
          title: composeText(ctx.post).slice(0, this.capabilities.maxTextLength),
          privacy_level: options.privacyLevel,
          disable_comment: creator.commentDisabled || !options.allowComment,
          disable_duet: creator.duetDisabled || !options.allowDuet,
          disable_stitch: creator.stitchDisabled || !options.allowStitch,
          brand_organic_toggle: options.commercial && options.yourBrand,
          brand_content_toggle: options.commercial && options.brandedContent,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: bytes.byteLength,
          chunk_size: chunks.chunkSize,
          total_chunk_count: chunks.count,
        },
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

    const uploadUrl = init.data?.upload_url;
    if (!uploadUrl) {
      throw new PlatformError({
        platform: this.platform,
        code: 'REJECTED',
        message: 'TikTok did not return an upload address for the video.',
        detail: JSON.stringify(init),
      });
    }
    for (let index = 0; index < chunks.count; index++) {
      const start = index * chunks.chunkSize;
      // The last chunk takes whatever is left, which TikTok allows to run over.
      const end = index === chunks.count - 1 ? bytes.byteLength : start + chunks.chunkSize;
      await platformFetch({
        platform: this.platform,
        method: 'PUT',
        url: uploadUrl,
        headers: {
          'content-type': video.mimeType || 'video/mp4',
          'content-length': String(end - start),
          'content-range': `bytes ${start}-${end - 1}/${bytes.byteLength}`,
        },
        body: new Uint8Array(bytes.subarray(start, end)),
        timeoutMs: 300_000,
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

/** TikTok takes one chunk up to 64 MB; anything larger goes in 10 MB pieces. */
export function uploadChunks(size: number): { chunkSize: number; count: number } {
  const single = 64 * 1024 * 1024;
  if (size <= single) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * 1024 * 1024;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

function creatorInfoMessage(code: string, fallback?: string): string {
  switch (code) {
    case 'spam_risk_too_many_posts':
      return 'This TikTok account has reached its daily posting limit. Try again later.';
    case 'spam_risk_user_banned_from_posting':
      return 'TikTok is not letting this account post right now.';
    case 'reached_active_user_cap':
      return 'TikTok has limited how many accounts this app can post for today. Try again later.';
    default:
      return fallback || 'TikTok could not say whether this account can post right now.';
  }
}
