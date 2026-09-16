import { Platform } from '@prisma/client';
import { CAPABILITIES } from '@/lib/social/capabilities';
import { composeText } from '@/lib/social/base';
import { GRAPH, MetaAdapter } from '@/lib/social/adapters/meta';
import { platformJson } from '@/lib/social/http';
import { PlatformError } from '@/lib/social/errors';
import type {
  AccountMetrics,
  ConnectionResult,
  DecryptedAccount,
  OutgoingMedia,
  PlatformPostStatus,
  PlatformProfile,
  PostMetrics,
  PublishContext,
  PublishResult,
} from '@/lib/social/types';

/**
 * Instagram Graph API (Business/Creator accounts only).
 *
 * Publishing is two-phase everywhere: build a media container, then publish it.
 * Carousels add a third phase — a container per child, then a parent container.
 *
 * INTEGRATION BOUNDARY — needs instagram_content_publish and App Review.
 *
 * Scope names below match the app dashboard's own Permissions and features
 * list (Use cases → Instagram API), which shows each permission's real,
 * currently-granted status ("Ready for testing") — that page is authoritative.
 * The dashboard's own "Customize use case" summary page disagrees with it,
 * displaying this one as instagram_content_publishing; that page's wording
 * is wrong. instagram_manage_insights is not in the app's granted set at all —
 * insights live behind a separate optional permission neither page listed as
 * required, so both analytics methods below degrade to nulls rather than
 * assume it was granted.
 */
export class InstagramAdapter extends MetaAdapter {
  readonly platform = Platform.INSTAGRAM;
  readonly capabilities = CAPABILITIES.INSTAGRAM;
  protected readonly scopes = [
    'instagram_basic',
    'instagram_content_publish',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
  ];

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<ConnectionResult[]> {
    const userToken = await this.exchangeForLongLivedToken(input.code, input.redirectUri);
    const pages = await this.listPages(userToken);

    // Only Pages with a linked Instagram Business account can publish.
    const connectable = pages.filter((p) => p.instagram_business_account?.id);
    if (connectable.length === 0) {
      throw new PlatformError({
        platform: this.platform,
        code: 'NO_ACCOUNT',
        message:
          'No Instagram Business account was found. Link your Instagram account to a Facebook Page, then connect again.',
      });
    }

    return connectable.map((page) => {
      const ig = page.instagram_business_account!;
      return {
        externalAccountId: ig.id,
        accountName: ig.name ?? ig.username ?? page.name,
        accountHandle: ig.username ? `@${ig.username}` : undefined,
        avatarUrl: ig.profile_picture_url,
        // Instagram publishing authenticates with the *Page* token.
        accessToken: page.access_token,
        scopes: this.scopes,
        // accountType is what the channels page shows as "Account type"; it
        // was missing entirely, which read as "Unavailable from platform" on
        // every real connection. "business" is never a guess here — an
        // instagram_business_account only exists on a Page at all for a
        // professional (Business or Creator) account, never a personal one,
        // so this is true regardless of which of those two Meta considers it.
        metadata: { pageId: page.id, pageName: page.name, accountType: 'business' },
      };
    });
  }

  async getAccount(account: DecryptedAccount): Promise<PlatformProfile> {
    const token = this.requireToken(account);
    const data = await platformJson<{
      id: string;
      username?: string;
      name?: string;
      profile_picture_url?: string;
      followers_count?: number;
      follows_count?: number;
    }>({
      platform: this.platform,
      url: `${GRAPH}/${account.externalAccountId}?fields=id,username,name,profile_picture_url,followers_count,follows_count&access_token=${encodeURIComponent(token)}`,
    });
    return {
      externalAccountId: data.id,
      accountName: data.name ?? data.username ?? account.accountName,
      accountHandle: data.username ? `@${data.username}` : undefined,
      avatarUrl: data.profile_picture_url,
      followers: data.followers_count,
      following: data.follows_count,
    };
  }

  async publishTextPost(): Promise<PublishResult> {
    throw new PlatformError({
      platform: this.platform,
      code: 'MEDIA_REQUIRED',
      message: 'Instagram posts need at least one image or video.',
    });
  }

  async publishMediaPost(ctx: PublishContext): Promise<PublishResult> {
    const token = this.requireToken(ctx.account);
    const igUser = ctx.account.externalAccountId;
    const caption = composeText(ctx.post);

    const containerId =
      ctx.post.media.length === 1
        ? await this.createContainer(igUser, token, ctx.post.media[0], { caption })
        : await this.createCarousel(igUser, token, ctx.post.media, caption);

    return this.publishContainer(ctx, igUser, token, containerId, caption);
  }

  async publishVideoPost(ctx: PublishContext): Promise<PublishResult> {
    const token = this.requireToken(ctx.account);
    const igUser = ctx.account.externalAccountId;
    const caption = composeText(ctx.post);
    const video = ctx.post.media.find((m) => m.type === 'VIDEO')!;

    const containerId = await this.createContainer(igUser, token, video, { caption, reel: true });
    // Video containers transcode asynchronously; publishing early is rejected.
    await this.pollUntilReady(async () => {
      const status = await platformJson<{ status_code?: string; status?: string }>({
        platform: this.platform,
        url: `${GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
      });
      return {
        ready: status.status_code === 'FINISHED',
        failed: status.status_code === 'ERROR' || status.status_code === 'EXPIRED',
        message: status.status,
      };
    });

    return this.publishContainer(ctx, igUser, token, containerId, caption);
  }

  private async createContainer(
    igUser: string,
    token: string,
    item: OutgoingMedia,
    opts: { caption?: string; reel?: boolean; carouselChild?: boolean },
  ): Promise<string> {
    const params = new URLSearchParams({ access_token: token });
    if (item.type === 'VIDEO') {
      params.set('video_url', item.url);
      params.set('media_type', opts.reel ? 'REELS' : 'VIDEO');
    } else {
      params.set('image_url', item.url);
    }
    if (opts.caption && !opts.carouselChild) params.set('caption', opts.caption);
    if (opts.carouselChild) params.set('is_carousel_item', 'true');
    if (item.altText) params.set('alt_text', item.altText);

    const res = await platformJson<{ id: string }>({
      platform: this.platform,
      method: 'POST',
      url: `${GRAPH}/${igUser}/media`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      timeoutMs: 60_000,
    });
    return res.id;
  }

  private async createCarousel(
    igUser: string,
    token: string,
    media: OutgoingMedia[],
    caption: string,
  ): Promise<string> {
    const children: string[] = [];
    for (const item of media) {
      children.push(await this.createContainer(igUser, token, item, { carouselChild: true }));
    }
    const params = new URLSearchParams({
      access_token: token,
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption,
    });
    const res = await platformJson<{ id: string }>({
      platform: this.platform,
      method: 'POST',
      url: `${GRAPH}/${igUser}/media`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      timeoutMs: 60_000,
    });
    return res.id;
  }

  private async publishContainer(
    ctx: PublishContext,
    igUser: string,
    token: string,
    containerId: string,
    _caption: string,
  ): Promise<PublishResult> {
    const res = await platformJson<{ id: string }>({
      platform: this.platform,
      method: 'POST',
      url: `${GRAPH}/${igUser}/media_publish`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: token, creation_id: containerId }).toString(),
      timeoutMs: 60_000,
    });

    if (ctx.post.firstComment) {
      // A failed first comment must not fail a post that already went live.
      await platformJson({
        platform: this.platform,
        method: 'POST',
        url: `${GRAPH}/${res.id}/comments`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: token, message: ctx.post.firstComment }).toString(),
      }).catch((e) => console.error('[instagram] first comment failed', e));
    }

    return {
      platformPostId: res.id,
      url: `https://www.instagram.com/p/${res.id}`,
      publishedAt: new Date(),
      raw: { containerId },
    };
  }

  async getPost(account: DecryptedAccount, platformPostId: string): Promise<PlatformPostStatus> {
    const token = this.requireToken(account);
    try {
      const data = await platformJson<{ id: string; permalink?: string; timestamp?: string }>({
        platform: this.platform,
        url: `${GRAPH}/${platformPostId}?fields=id,permalink,timestamp&access_token=${encodeURIComponent(token)}`,
      });
      return {
        platformPostId: data.id,
        exists: true,
        url: data.permalink,
        publishedAt: data.timestamp ? new Date(data.timestamp) : undefined,
      };
    } catch (error) {
      if (error instanceof PlatformError && error.code === 'NOT_FOUND') {
        return { platformPostId, exists: false };
      }
      throw error;
    }
  }

  async getPostAnalytics(account: DecryptedAccount, platformPostId: string): Promise<PostMetrics> {
    const token = this.requireToken(account);
    const metrics = 'impressions,reach,likes,comments,saved,shares';
    // Insights is an optional permission this app does not request by
    // default (see the scopes comment above) — a connected account that never
    // granted it gets nulls here, matching getAccountAnalytics below, rather
    // than a thrown error surfacing as a broken-looking analytics tab.
    const data = await platformJson<{ data?: { name: string; values?: { value?: number }[] }[] }>({
      platform: this.platform,
      url: `${GRAPH}/${platformPostId}/insights?metric=${metrics}&access_token=${encodeURIComponent(token)}`,
    }).catch(() => ({ data: [] }));
    const value = (name: string) => data.data?.find((d) => d.name === name)?.values?.[0]?.value ?? null;
    return {
      impressions: value('impressions'),
      reach: value('reach'),
      likes: value('likes'),
      comments: value('comments'),
      saves: value('saved'),
      shares: value('shares'),
      // Instagram does not report link clicks on organic feed posts.
      clicks: null,
      raw: data as Record<string, unknown>,
    };
  }

  async getAccountAnalytics(account: DecryptedAccount): Promise<AccountMetrics> {
    const profile = await this.getAccount(account);
    const token = this.requireToken(account);
    const insights = await platformJson<{ data?: { name: string; values?: { value?: number }[] }[] }>({
      platform: this.platform,
      url: `${GRAPH}/${account.externalAccountId}/insights?metric=impressions,reach,profile_views&period=day&access_token=${encodeURIComponent(token)}`,
    }).catch(() => ({ data: [] }));
    const value = (name: string) => insights.data?.find((d) => d.name === name)?.values?.[0]?.value ?? null;
    return {
      followers: profile.followers ?? null,
      following: profile.following ?? null,
      impressions: value('impressions'),
      reach: value('reach'),
      profileViews: value('profile_views'),
      raw: insights as Record<string, unknown>,
    };
  }
}
