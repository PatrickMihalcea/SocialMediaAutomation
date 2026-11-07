import { Platform } from '@prisma/client';
import { CAPABILITIES } from '@/lib/social/capabilities';
import { composeText } from '@/lib/social/base';
import { GRAPH, GRAPH_VERSION, MetaAdapter } from '@/lib/social/adapters/meta';
import { platformJson } from '@/lib/social/http';
import { PlatformError } from '@/lib/social/errors';
import type {
  AccountMetrics,
  ConnectionResult,
  DecryptedAccount,
  PlatformPostStatus,
  PlatformProfile,
  PostMetrics,
  OutgoingMedia,
  PublishContext,
  PublishResult,
} from '@/lib/social/types';

/**
 * Facebook Pages via the Graph API.
 *
 * INTEGRATION BOUNDARY — needs pages_manage_posts + pages_read_engagement and
 * Meta App Review before it can post to Pages the developer does not administer.
 */
export class FacebookAdapter extends MetaAdapter {
  readonly platform = Platform.FACEBOOK;
  readonly capabilities = CAPABILITIES.FACEBOOK;
  protected readonly scopes = [
    'pages_show_list',
    'pages_manage_posts',
    'pages_read_engagement',
    'pages_manage_engagement',
    'read_insights',
    'business_management',
  ];

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<ConnectionResult[]> {
    const userToken = await this.exchangeForLongLivedToken(input.code, input.redirectUri);
    const pages = await this.listPages(userToken);
    if (pages.length === 0) {
      throw new PlatformError({
        platform: this.platform,
        code: 'NO_ACCOUNT',
        message: 'No Facebook Pages were found on that account. You need to administer at least one Page.',
      });
    }
    return pages.map((page) => ({
      externalAccountId: page.id,
      accountName: page.name,
      accountHandle: page.username ? `@${page.username}` : undefined,
      avatarUrl: page.picture?.data?.url,
      accessToken: page.access_token,
      scopes: this.scopes,
      metadata: { pageId: page.id },
    }));
  }

  async getAccount(account: DecryptedAccount): Promise<PlatformProfile> {
    const token = this.requireToken(account);
    const data = await platformJson<{
      id: string;
      name: string;
      username?: string;
      followers_count?: number;
      picture?: { data?: { url?: string } };
    }>({
      platform: this.platform,
      url: `${GRAPH}/${account.externalAccountId}?fields=id,name,username,followers_count,picture{url}&access_token=${encodeURIComponent(token)}`,
    });
    return {
      externalAccountId: data.id,
      accountName: data.name,
      accountHandle: data.username ? `@${data.username}` : undefined,
      avatarUrl: data.picture?.data?.url,
      followers: data.followers_count,
    };
  }

  async publishTextPost(ctx: PublishContext): Promise<PublishResult> {
    const token = this.requireToken(ctx.account);
    const params = new URLSearchParams({ access_token: token, message: composeText(ctx.post) });
    if (ctx.post.link) params.set('link', ctx.post.link);
    const res = await this.post(`${ctx.account.externalAccountId}/feed`, params);
    return this.finish(ctx, res.id, token);
  }

  async publishMediaPost(ctx: PublishContext): Promise<PublishResult> {
    const token = this.requireToken(ctx.account);
    const pageId = ctx.account.externalAccountId;
    const message = composeText(ctx.post);
    const images = ctx.post.media.filter((m) => m.type !== 'VIDEO');

    if (images.length === 1) {
      const params = new URLSearchParams({ access_token: token, url: images[0].url, message });
      if (images[0].altText) params.set('alt_text_custom', images[0].altText);
      const res = await this.post(`${pageId}/photos`, params);
      return this.finish(ctx, res.post_id ?? res.id, token);
    }

    // Multi-photo: stage each photo unpublished, then attach them to one feed post.
    const attached: string[] = [];
    for (const image of images) {
      const staged = await this.post(
        `${pageId}/photos`,
        new URLSearchParams({ access_token: token, url: image.url, published: 'false' }),
      );
      attached.push(staged.id);
    }
    const params = new URLSearchParams({ access_token: token, message });
    attached.forEach((id, i) => params.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
    const res = await this.post(`${pageId}/feed`, params);
    return this.finish(ctx, res.id, token);
  }

  /**
   * A video goes out as a Reel whenever it can be one.
   *
   * This used to post every video to /videos, which makes a plain Page video:
   * shown to the Page's followers and almost nobody else. Reels are what
   * Facebook recommends to people who do not follow you, so for a new Page a
   * plain video is close to invisible however public it is. Everything this
   * app renders is a vertical short, so the Reel path is the normal one; a
   * video Meta would refuse as a Reel still goes out, as a Page video.
   */
  async publishVideoPost(ctx: PublishContext): Promise<PublishResult> {
    const token = this.requireToken(ctx.account);
    const video = ctx.post.media.find((m) => m.type === 'VIDEO')!;
    if (!canBeReel(video)) return this.publishPageVideo(ctx, token, video);
    return this.publishReel(ctx, token, video);
  }

  /**
   * Meta's three-step Reels upload: open an upload, have Facebook fetch the
   * file from our URL, then publish it.
   */
  private async publishReel(ctx: PublishContext, token: string, video: OutgoingMedia): Promise<PublishResult> {
    const pageId = ctx.account.externalAccountId;

    const started = await platformJson<{ video_id?: string }>({
      platform: this.platform,
      method: 'POST',
      url: `${GRAPH}/${pageId}/video_reels`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: token, upload_phase: 'start' }).toString(),
    });
    const videoId = started.video_id;
    if (!videoId) {
      throw new PlatformError({
        platform: this.platform,
        code: 'BAD_RESPONSE',
        message: 'Facebook did not open an upload for this Reel.',
        retryable: true,
      });
    }

    // Facebook pulls the file itself from the signed URL, so the bytes never
    // pass through this process — the same way the old /videos call worked.
    const uploaded = await platformJson<{ success?: boolean }>({
      platform: this.platform,
      method: 'POST',
      url: `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}/${videoId}`,
      headers: { authorization: `OAuth ${token}`, file_url: video.url },
      timeoutMs: 120_000,
    });
    if (uploaded.success === false) {
      throw new PlatformError({
        platform: this.platform,
        code: 'MEDIA_REJECTED',
        message: 'Facebook could not fetch this video to make a Reel from it.',
        retryable: true,
      });
    }

    const params = new URLSearchParams({
      access_token: token,
      upload_phase: 'finish',
      video_id: videoId,
      video_state: 'PUBLISHED',
      description: composeText(ctx.post),
    });
    if (ctx.post.title) params.set('title', ctx.post.title);
    await platformJson<{ success?: boolean }>({
      platform: this.platform,
      method: 'POST',
      url: `${GRAPH}/${pageId}/video_reels`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      timeoutMs: 60_000,
    });

    await this.waitForReel(videoId, token);
    return { ...(await this.finish(ctx, videoId, token)), url: `https://www.facebook.com/reel/${videoId}` };
  }

  /**
   * Watches the Reel through processing, for long enough to catch Meta
   * refusing it.
   *
   * It deliberately does not fail on running out of patience. Once the
   * publish call has been accepted the Reel goes live on its own, and a
   * retry from here would upload it a second time — a duplicate post is
   * worse than reporting success a minute early. Only a definite error from
   * Meta fails the step.
   */
  private async waitForReel(videoId: string, token: string): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const { status } = await platformJson<{ status?: ReelStatus }>({
        platform: this.platform,
        url: `${GRAPH}/${videoId}?fields=status&access_token=${encodeURIComponent(token)}`,
      });
      const failure = reelFailure(status);
      if (failure) {
        throw new PlatformError({
          platform: this.platform,
          code: 'MEDIA_REJECTED',
          message: `Facebook refused this Reel: ${failure}`,
        });
      }
      if (status?.publishing_phase?.status === 'complete') return;
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }

  /** The old path, kept for videos Meta would not accept as a Reel. */
  private async publishPageVideo(ctx: PublishContext, token: string, video: OutgoingMedia): Promise<PublishResult> {
    const params = new URLSearchParams({
      access_token: token,
      file_url: video.url,
      description: composeText(ctx.post),
    });
    if (ctx.post.title) params.set('title', ctx.post.title);
    const res = await platformJson<{ id: string }>({
      platform: this.platform,
      method: 'POST',
      url: `${GRAPH}/${ctx.account.externalAccountId}/videos`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      timeoutMs: 120_000,
    });
    return this.finish(ctx, res.id, token);
  }

  private async post(path: string, params: URLSearchParams) {
    return platformJson<{ id: string; post_id?: string }>({
      platform: this.platform,
      method: 'POST',
      url: `${GRAPH}/${path}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      timeoutMs: 60_000,
    });
  }

  private async finish(ctx: PublishContext, id: string, token: string): Promise<PublishResult> {
    if (ctx.post.firstComment) {
      await this.post(
        `${id}/comments`,
        new URLSearchParams({ access_token: token, message: ctx.post.firstComment }),
      ).catch((e) => console.error('[facebook] first comment failed', e));
    }
    return {
      platformPostId: id,
      url: `https://www.facebook.com/${id}`,
      publishedAt: new Date(),
    };
  }

  async getPost(account: DecryptedAccount, platformPostId: string): Promise<PlatformPostStatus> {
    const token = this.requireToken(account);
    try {
      const data = await platformJson<{ id: string; permalink_url?: string; created_time?: string }>({
        platform: this.platform,
        url: `${GRAPH}/${platformPostId}?fields=id,permalink_url,created_time&access_token=${encodeURIComponent(token)}`,
      });
      return {
        platformPostId: data.id,
        exists: true,
        url: data.permalink_url,
        publishedAt: data.created_time ? new Date(data.created_time) : undefined,
      };
    } catch (error) {
      if (error instanceof PlatformError && error.code === 'NOT_FOUND') return { platformPostId, exists: false };
      throw error;
    }
  }

  async deletePost(account: DecryptedAccount, platformPostId: string): Promise<void> {
    const token = this.requireToken(account);
    await platformJson({
      platform: this.platform,
      method: 'DELETE',
      url: `${GRAPH}/${platformPostId}?access_token=${encodeURIComponent(token)}`,
    });
  }

  async getPostAnalytics(account: DecryptedAccount, platformPostId: string): Promise<PostMetrics> {
    const token = this.requireToken(account);
    // A Page post id is "pageid_postid"; a Reel is a bare video id, and a
    // video has no /insights edge at all. Asking for it failed every Reel's
    // sync, so Reels read the video's own insights instead.
    if (!platformPostId.includes('_')) return this.getReelAnalytics(token, platformPostId);
    const metrics = [
      'post_impressions',
      'post_impressions_unique',
      'post_clicks',
      'post_reactions_by_type_total',
      'post_video_views',
    ].join(',');
    const data = await platformJson<{ data?: { name: string; values?: { value?: number | Record<string, number> }[] }[] }>({
      platform: this.platform,
      url: `${GRAPH}/${platformPostId}/insights?metric=${metrics}&access_token=${encodeURIComponent(token)}`,
    });
    const raw = (name: string) => data.data?.find((d) => d.name === name)?.values?.[0]?.value;
    const num = (name: string) => {
      const v = raw(name);
      return typeof v === 'number' ? v : null;
    };
    const reactions = raw('post_reactions_by_type_total');
    const likes =
      reactions && typeof reactions === 'object'
        ? Object.values(reactions).reduce((a, b) => a + (b ?? 0), 0)
        : null;

    const counts: {
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
    } = await platformJson<{
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
    }>({
      platform: this.platform,
      url: `${GRAPH}/${platformPostId}?fields=comments.summary(true),shares&access_token=${encodeURIComponent(token)}`,
    }).catch(() => ({}));

    return {
      impressions: num('post_impressions'),
      reach: num('post_impressions_unique'),
      clicks: num('post_clicks'),
      videoViews: num('post_video_views'),
      likes,
      comments: counts.comments?.summary?.total_count ?? null,
      shares: counts.shares?.count ?? null,
      // Facebook does not report saves for Page posts.
      saves: null,
      raw: data as Record<string, unknown>,
    };
  }

  private async getReelAnalytics(token: string, videoId: string): Promise<PostMetrics> {
    const data = await platformJson<{ data?: { name: string; values?: { value?: number | Record<string, number> }[] }[] }>({
      platform: this.platform,
      url: `${GRAPH}/${videoId}/video_insights?access_token=${encodeURIComponent(token)}`,
    });
    const raw = (name: string) => data.data?.find((d) => d.name === name)?.values?.[0]?.value;
    const num = (name: string) => {
      const v = raw(name);
      return typeof v === 'number' ? v : null;
    };
    const tally = (name: string, key?: string) => {
      const v = raw(name);
      if (!v || typeof v !== 'object') return null;
      return key ? v[key] ?? 0 : Object.values(v).reduce((a, b) => a + (b ?? 0), 0);
    };
    const plays = num('fb_reels_total_plays');
    return {
      // A Reel's plays are its views; Facebook reports no separate impressions.
      impressions: plays,
      videoViews: plays,
      reach: null,
      likes: tally('post_video_likes_by_reaction_type'),
      comments: tally('post_video_social_actions', 'COMMENT'),
      shares: tally('post_video_social_actions', 'SHARE'),
      saves: null,
      clicks: null,
      raw: data as Record<string, unknown>,
    };
  }

  async getAccountAnalytics(account: DecryptedAccount): Promise<AccountMetrics> {
    const profile = await this.getAccount(account);
    const token = this.requireToken(account);
    const insights = await platformJson<{ data?: { name: string; values?: { value?: number }[] }[] }>({
      platform: this.platform,
      url: `${GRAPH}/${account.externalAccountId}/insights?metric=page_impressions,page_impressions_unique,page_post_engagements&period=day&access_token=${encodeURIComponent(token)}`,
    }).catch(() => ({ data: [] }));
    const value = (name: string) => insights.data?.find((d) => d.name === name)?.values?.[0]?.value ?? null;
    return {
      followers: profile.followers ?? null,
      impressions: value('page_impressions'),
      reach: value('page_impressions_unique'),
      engagements: value('page_post_engagements'),
      raw: insights as Record<string, unknown>,
    };
  }
}

interface ReelPhase {
  status?: string;
  errors?: Array<{ message?: string }>;
}

interface ReelStatus {
  video_status?: string;
  uploading_phase?: ReelPhase;
  processing_phase?: ReelPhase;
  publishing_phase?: ReelPhase;
}

/** What Meta said went wrong, or null while nothing has. */
export function reelFailure(status: ReelStatus | undefined): string | null {
  if (!status) return null;
  const phases = [status.uploading_phase, status.processing_phase, status.publishing_phase];
  const failed = phases.find((phase) => phase?.status === 'error');
  if (failed) return failed.errors?.[0]?.message ?? 'it failed while processing.';
  if (status.video_status === 'error') return 'it failed while processing.';
  return null;
}

/**
 * Whether Meta will take this video as a Reel: vertical, 3 to 90 seconds,
 * at least 540x960.
 *
 * Unknown dimensions or length count as yes. Everything this app renders is a
 * vertical short, and a file we know nothing about is far more likely one of
 * those than not — refusing to try would quietly send it out as the plain
 * video nobody sees.
 */
export function canBeReel(video: Pick<OutgoingMedia, 'width' | 'height' | 'durationSeconds'>): boolean {
  const { width, height, durationSeconds } = video;
  if (durationSeconds != null && (durationSeconds < 3 || durationSeconds > 90)) return false;
  if (width != null && height != null) {
    if (width >= height) return false;
    if (width < 540 || height < 960) return false;
  }
  return true;
}
