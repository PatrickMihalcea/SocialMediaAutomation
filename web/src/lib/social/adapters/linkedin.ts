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

const API = 'https://api.linkedin.com';
const REST_VERSION = '202411';

/**
 * LinkedIn — personal profiles and organization pages through the Posts API.
 *
 * Media is a three-step dance: ask LinkedIn to initialize an upload, PUT the
 * bytes to the URL it hands back, then reference the returned URN in the post.
 *
 * INTEGRATION BOUNDARY — posting as an organization needs the Community
 * Management API, which LinkedIn grants per application.
 */
export class LinkedInAdapter extends BaseAdapter {
  readonly platform = Platform.LINKEDIN;
  readonly capabilities = CAPABILITIES.LINKEDIN;

  private readonly scopes = ['openid', 'profile', 'email', 'w_member_social', 'r_organization_social', 'w_organization_social', 'rw_organization_admin'];

  isConfigured(): boolean {
    return Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET);
  }

  async getAuthorizationUrl(input: { redirectUri: string; state: string }): Promise<AuthorizationRequest> {
    if (!this.isConfigured()) throw notConfigured(this.platform);
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', env.LINKEDIN_CLIENT_ID);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', input.state);
    url.searchParams.set('scope', this.scopes.join(' '));
    return { url: url.toString() };
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<ConnectionResult[]> {
    if (!this.isConfigured()) throw notConfigured(this.platform);
    const token = await platformJson<{
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/oauth/v2/accessToken`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      }).toString(),
    });

    const expiresAt = new Date(Date.now() + token.expires_in * 1000);
    const results: ConnectionResult[] = [];

    const me = await platformJson<{ sub: string; name?: string; picture?: string; email?: string }>({
      platform: this.platform,
      url: `${API}/v2/userinfo`,
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    results.push({
      externalAccountId: `urn:li:person:${me.sub}`,
      accountName: me.name ?? 'LinkedIn profile',
      avatarUrl: me.picture,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
      scopes: this.scopes,
      metadata: { kind: 'person', personId: me.sub },
    });

    // Organizations the member administers, if the app holds the org scopes.
    const orgs = await platformJson<{
      elements?: { organizationalTarget: string; role: string; state: string }[];
    }>({
      platform: this.platform,
      url: `${API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
      headers: this.headers(token.access_token),
    }).catch(() => ({ elements: [] }));

    for (const acl of orgs.elements ?? []) {
      const id = acl.organizationalTarget.split(':').pop();
      const org: { localizedName?: string; vanityName?: string } = await platformJson<{
        localizedName?: string;
        vanityName?: string;
      }>({
        platform: this.platform,
        url: `${API}/rest/organizations/${id}`,
        headers: this.headers(token.access_token),
      }).catch(() => ({}));
      results.push({
        externalAccountId: acl.organizationalTarget,
        accountName: org.localizedName ?? `Organization ${id}`,
        accountHandle: org.vanityName ? `@${org.vanityName}` : undefined,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        scopes: this.scopes,
        metadata: { kind: 'organization', organizationId: id },
      });
    }

    return results;
  }

  async refreshToken(account: DecryptedAccount): Promise<RefreshedToken | null> {
    if (!account.refreshToken || !this.isConfigured()) return null;
    const token = await platformJson<{ access_token: string; expires_in: number; refresh_token?: string }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/oauth/v2/accessToken`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
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
    await platformFetch({
      platform: this.platform,
      method: 'POST',
      url: `${API}/oauth/v2/revoke`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      }).toString(),
    });
  }

  async getAccount(account: DecryptedAccount): Promise<PlatformProfile> {
    const token = this.requireToken(account);
    if (account.metadata.kind === 'organization') {
      const id = account.metadata.organizationId as string;
      const org = await platformJson<{ localizedName?: string; vanityName?: string }>({
        platform: this.platform,
        url: `${API}/rest/organizations/${id}`,
        headers: this.headers(token),
      });
      const followers: { firstDegreeSize?: number } = await platformJson<{
        firstDegreeSize?: number;
      }>({
        platform: this.platform,
        url: `${API}/rest/networkSizes/${encodeURIComponent(account.externalAccountId)}?edgeType=CompanyFollowedByMember`,
        headers: this.headers(token),
      }).catch(() => ({}));
      return {
        externalAccountId: account.externalAccountId,
        accountName: org.localizedName ?? account.accountName,
        accountHandle: org.vanityName ? `@${org.vanityName}` : undefined,
        followers: followers.firstDegreeSize,
      };
    }
    const me = await platformJson<{ sub: string; name?: string; picture?: string }>({
      platform: this.platform,
      url: `${API}/v2/userinfo`,
      headers: { authorization: `Bearer ${token}` },
    });
    return {
      externalAccountId: account.externalAccountId,
      accountName: me.name ?? account.accountName,
      avatarUrl: me.picture,
    };
  }

  async publishTextPost(ctx: PublishContext): Promise<PublishResult> {
    return this.createPost(ctx, null);
  }

  async publishMediaPost(ctx: PublishContext): Promise<PublishResult> {
    const token = this.requireToken(ctx.account);
    const images = ctx.post.media.filter((m) => m.type !== 'VIDEO');
    const urns: { id: string; altText?: string }[] = [];
    for (const image of images) {
      urns.push({ id: await this.uploadAsset(ctx.account, token, image, 'images'), altText: image.altText ?? undefined });
    }
    const content =
      urns.length === 1
        ? { media: { id: urns[0].id, altText: urns[0].altText } }
        : { multiImage: { images: urns.map((u) => ({ id: u.id, altText: u.altText })) } };
    return this.createPost(ctx, content);
  }

  async publishVideoPost(ctx: PublishContext): Promise<PublishResult> {
    const token = this.requireToken(ctx.account);
    const video = ctx.post.media.find((m) => m.type === 'VIDEO')!;
    const id = await this.uploadAsset(ctx.account, token, video, 'videos');
    return this.createPost(ctx, { media: { id, title: ctx.post.title ?? video.filename } });
  }

  /** initializeUpload → PUT bytes → the returned URN is referenced by the post. */
  private async uploadAsset(
    account: DecryptedAccount,
    token: string,
    item: OutgoingMedia,
    kind: 'images' | 'videos',
  ): Promise<string> {
    // Once, before initializing: the declared size must describe these exact
    // bytes, and reading twice would pull a large video out of storage twice.
    const bytes = await item.read();
    const init = await platformJson<{
      value: { uploadUrl?: string; image?: string; video?: string; uploadInstructions?: { uploadUrl: string }[] };
    }>({
      platform: this.platform,
      method: 'POST',
      url: `${API}/rest/${kind}?action=initializeUpload`,
      headers: { ...this.headers(token), 'content-type': 'application/json' },
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: account.externalAccountId,
          ...(kind === 'videos' ? { fileSizeBytes: bytes.byteLength, uploadCaptions: false } : {}),
        },
      }),
    });

    const uploadUrl = init.value.uploadUrl ?? init.value.uploadInstructions?.[0]?.uploadUrl;
    const urn = init.value.image ?? init.value.video;
    if (!uploadUrl || !urn) {
      throw new PlatformError({
        platform: this.platform,
        code: 'UPLOAD_INIT',
        retryable: true,
        message: 'LinkedIn did not accept the media upload. Bridge88 will try again.',
        detail: JSON.stringify(init),
      });
    }

    await platformFetch({
      platform: this.platform,
      method: 'PUT',
      url: uploadUrl,
      headers: { authorization: `Bearer ${token}`, 'content-type': item.mimeType },
      body: new Uint8Array(bytes),
      timeoutMs: 180_000,
    });
    return urn;
  }

  private async createPost(ctx: PublishContext, content: unknown): Promise<PublishResult> {
    const token = this.requireToken(ctx.account);
    const body: Record<string, unknown> = {
      author: ctx.account.externalAccountId,
      commentary: composeText(ctx.post),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (content) body.content = content;

    const response = await platformFetch({
      platform: this.platform,
      method: 'POST',
      url: `${API}/rest/posts`,
      headers: {
        ...this.headers(token),
        'content-type': 'application/json',
        // LinkedIn dedupes on this header, which makes a retry safe.
        'x-restli-method': 'create',
        'X-RestLi-Request-Id': ctx.idempotencyKey.slice(0, 64),
      },
      body: JSON.stringify(body),
      timeoutMs: 60_000,
    });

    const id = response.headers.get('x-restli-id') ?? response.headers.get('x-linkedin-id');
    if (!id) {
      throw new PlatformError({
        platform: this.platform,
        code: 'NO_ID',
        retryable: true,
        message: 'LinkedIn accepted the post but did not return its id. Bridge88 will verify and retry.',
      });
    }

    if (ctx.post.firstComment) {
      await platformJson({
        platform: this.platform,
        method: 'POST',
        url: `${API}/rest/socialActions/${encodeURIComponent(id)}/comments`,
        headers: { ...this.headers(token), 'content-type': 'application/json' },
        body: JSON.stringify({ actor: ctx.account.externalAccountId, message: { text: ctx.post.firstComment } }),
      }).catch((e) => console.error('[linkedin] first comment failed', e));
    }

    return {
      platformPostId: id,
      url: `https://www.linkedin.com/feed/update/${id}`,
      publishedAt: new Date(),
    };
  }

  async getPost(account: DecryptedAccount, platformPostId: string): Promise<PlatformPostStatus> {
    const token = this.requireToken(account);
    try {
      await platformJson({
        platform: this.platform,
        url: `${API}/rest/posts/${encodeURIComponent(platformPostId)}`,
        headers: this.headers(token),
      });
      return {
        platformPostId,
        exists: true,
        url: `https://www.linkedin.com/feed/update/${platformPostId}`,
      };
    } catch (error) {
      if (error instanceof PlatformError && error.code === 'NOT_FOUND') return { platformPostId, exists: false };
      throw error;
    }
  }

  async deletePost(account: DecryptedAccount, platformPostId: string): Promise<void> {
    const token = this.requireToken(account);
    await platformFetch({
      platform: this.platform,
      method: 'DELETE',
      url: `${API}/rest/posts/${encodeURIComponent(platformPostId)}`,
      headers: this.headers(token),
    });
  }

  async getPostAnalytics(account: DecryptedAccount, platformPostId: string): Promise<PostMetrics> {
    const token = this.requireToken(account);
    const stats = await platformJson<{
      elements?: {
        totalShareStatistics?: {
          impressionCount?: number;
          likeCount?: number;
          commentCount?: number;
          shareCount?: number;
          clickCount?: number;
        };
      }[];
    }>({
      platform: this.platform,
      url: `${API}/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(account.externalAccountId)}&shares[0]=${encodeURIComponent(platformPostId)}`,
      headers: this.headers(token),
    });
    const s = stats.elements?.[0]?.totalShareStatistics;
    return {
      impressions: s?.impressionCount ?? null,
      likes: s?.likeCount ?? null,
      comments: s?.commentCount ?? null,
      shares: s?.shareCount ?? null,
      clicks: s?.clickCount ?? null,
      // LinkedIn reports no unique reach or saves on the share statistics API.
      reach: null,
      saves: null,
      raw: stats as Record<string, unknown>,
    };
  }

  async getAccountAnalytics(account: DecryptedAccount): Promise<AccountMetrics> {
    const profile = await this.getAccount(account);
    return { followers: profile.followers ?? null, following: null };
  }

  private headers(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      'LinkedIn-Version': REST_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    };
  }
}
