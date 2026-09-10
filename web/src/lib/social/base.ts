import type { Platform } from '@prisma/client';
import { PlatformError, platformLabel } from '@/lib/social/errors';
import type {
  AccountMetrics,
  AccountValidation,
  AuthorizationRequest,
  ConnectionResult,
  DecryptedAccount,
  OutgoingMedia,
  OutgoingPost,
  PlatformCapabilities,
  PlatformPostStatus,
  PlatformProfile,
  PostMetrics,
  PublishContext,
  PublishResult,
  RefreshedToken,
  SocialPlatformAdapter,
  ValidationIssue,
} from '@/lib/social/types';

const mb = (n: number) => n * 1024 * 1024;
export const MB = mb;

/**
 * Shared adapter behaviour: capability-driven validation, the publish dispatch
 * that picks text/media/video, and honest "not supported" defaults. A network
 * adapter overrides only what it genuinely does differently.
 */
export abstract class BaseAdapter implements SocialPlatformAdapter {
  abstract readonly platform: Platform;
  abstract readonly capabilities: PlatformCapabilities;

  get label(): string {
    return platformLabel(this.platform);
  }

  abstract isConfigured(): boolean;

  abstract getAuthorizationUrl(input: { redirectUri: string; state: string }): Promise<AuthorizationRequest>;
  abstract exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<ConnectionResult[]>;
  abstract getAccount(account: DecryptedAccount): Promise<PlatformProfile>;

  /** Most networks issue long-lived tokens that cannot be refreshed silently. */
  async refreshToken(_account: DecryptedAccount): Promise<RefreshedToken | null> {
    return null;
  }

  async validateAccount(account: DecryptedAccount): Promise<AccountValidation> {
    if (!account.accessToken) {
      return { valid: false, needsReconnect: true, message: `${this.label} has no stored authorization.` };
    }
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now()) {
      return {
        valid: false,
        needsReconnect: true,
        message: `${this.label} authorization expired. Reconnect ${this.label} to continue publishing.`,
      };
    }
    try {
      await this.getAccount(account);
      return { valid: true };
    } catch (error) {
      if (error instanceof PlatformError) {
        return { valid: false, needsReconnect: error.needsReconnect, message: error.message };
      }
      throw error;
    }
  }

  /** Default disconnect is local-only; adapters with a revoke endpoint override. */
  async disconnect(_account: DecryptedAccount): Promise<void> {}

  // ------------------------------------------------------------ validation

  validatePost(post: OutgoingPost): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const caps = this.capabilities;
    const name = this.label;

    const fullText = composeText(post);
    if (fullText.trim().length === 0 && !caps.requiresMedia) {
      issues.push({ severity: 'error', code: 'EMPTY', field: 'text', message: 'Add some text before publishing.' });
    }
    if (fullText.length > caps.maxTextLength) {
      issues.push({
        severity: 'error',
        code: 'TEXT_TOO_LONG',
        field: 'text',
        message: `Post exceeds the ${name} character limit — ${fullText.length} of ${caps.maxTextLength.toLocaleString()} characters.`,
      });
    }

    const images = post.media.filter((m) => m.type === 'IMAGE' || m.type === 'GIF');
    const videos = post.media.filter((m) => m.type === 'VIDEO');

    if (caps.requiresMedia && post.media.length === 0) {
      issues.push({
        severity: 'error',
        code: 'MEDIA_REQUIRED',
        field: 'media',
        message: `${name} posts need at least one image or video.`,
      });
    }
    if (images.length > caps.maxImages) {
      issues.push({
        severity: 'error',
        code: 'TOO_MANY_IMAGES',
        field: 'media',
        message: `${name} takes at most ${caps.maxImages} image${caps.maxImages === 1 ? '' : 's'} per post — you have ${images.length}.`,
      });
    }
    if (videos.length > caps.maxVideos) {
      issues.push({
        severity: 'error',
        code: 'TOO_MANY_VIDEOS',
        field: 'media',
        message: `${name} takes at most ${caps.maxVideos} video${caps.maxVideos === 1 ? '' : 's'} per post — you have ${videos.length}.`,
      });
    }
    if (!caps.allowsMixedMedia && images.length > 0 && videos.length > 0) {
      issues.push({
        severity: 'error',
        code: 'MIXED_MEDIA',
        field: 'media',
        message: `${name} cannot mix images and video in one post.`,
      });
    }
    if (!caps.supportsLink && post.link) {
      issues.push({
        severity: 'warning',
        code: 'LINK_UNSUPPORTED',
        field: 'link',
        message: `${name} does not make links in captions clickable. Consider putting it in the profile or first comment.`,
      });
    }
    if (!caps.supportsFirstComment && post.firstComment) {
      issues.push({
        severity: 'warning',
        code: 'FIRST_COMMENT_UNSUPPORTED',
        field: 'firstComment',
        message: `${name} does not support a first comment — it will be skipped.`,
      });
    }

    for (const item of post.media) {
      issues.push(...this.validateMedia(item));
    }
    return issues;
  }

  protected validateMedia(item: OutgoingMedia): ValidationIssue[] {
    const isVideo = item.type === 'VIDEO';
    if (item.type === 'AUDIO') {
      return [
        {
          severity: 'error',
          field: 'media',
          mediaId: item.id,
          code: 'MIME_UNSUPPORTED',
          message: `${this.label} does not publish standalone audio. Attach it to a video post instead.`,
        },
      ];
    }
    const rules = isVideo ? this.capabilities.video : this.capabilities.image;
    const issues: ValidationIssue[] = [];
    const name = this.label;
    const base = { severity: 'error' as const, field: 'media' as const, mediaId: item.id };

    if (rules.mimeTypes.length && !rules.mimeTypes.includes(item.mimeType)) {
      issues.push({
        ...base,
        code: 'MIME_UNSUPPORTED',
        message: `${name} does not accept ${describeType(item.mimeType)} files. Accepted here: ${rules.mimeTypes
          .map(describeType)
          .join(', ')}.`,
      });
    }
    if (item.size > rules.maxBytes) {
      issues.push({
        ...base,
        code: 'FILE_TOO_LARGE',
        message: `"${item.filename}" is ${formatBytes(item.size)} — over the ${formatBytes(rules.maxBytes)} ${name} limit.`,
      });
    }
    if (item.width && item.height) {
      if (rules.minWidth && item.width < rules.minWidth) {
        issues.push({
          ...base,
          code: 'TOO_NARROW',
          message: `"${item.filename}" is ${item.width}px wide. ${name} needs at least ${rules.minWidth}px.`,
        });
      }
      if (rules.minHeight && item.height < rules.minHeight) {
        issues.push({
          ...base,
          code: 'TOO_SHORT',
          message: `"${item.filename}" is ${item.height}px tall. ${name} needs at least ${rules.minHeight}px.`,
        });
      }
      if (rules.maxWidth && item.width > rules.maxWidth) {
        issues.push({
          ...base,
          code: 'TOO_WIDE',
          message: `"${item.filename}" is ${item.width}px wide. ${name} allows up to ${rules.maxWidth}px.`,
        });
      }
      if (rules.aspectRatio) {
        const ratio = item.width / item.height;
        const [min, max] = rules.aspectRatio;
        if (ratio < min - 0.01 || ratio > max + 0.01) {
          issues.push({
            ...base,
            code: 'ASPECT_RATIO',
            message: `"${item.filename}" is ${ratio.toFixed(2)}:1. ${name} needs a ratio between ${min}:1 and ${max}:1 — crop it in the editor.`,
          });
        }
      }
    }
    if (isVideo && item.durationSeconds != null) {
      const v = this.capabilities.video;
      if (v.maxDurationSeconds && item.durationSeconds > v.maxDurationSeconds) {
        issues.push({
          ...base,
          code: 'VIDEO_TOO_LONG',
          message: `Your video is too long for ${name} — ${formatDuration(item.durationSeconds)} against a ${formatDuration(v.maxDurationSeconds)} limit. Trim it in the editor.`,
        });
      }
      if (v.minDurationSeconds && item.durationSeconds < v.minDurationSeconds) {
        issues.push({
          ...base,
          code: 'VIDEO_TOO_SHORT',
          message: `Your video is too short for ${name} — ${formatDuration(item.durationSeconds)} against a ${formatDuration(v.minDurationSeconds)} minimum.`,
        });
      }
    }
    return issues;
  }

  // ------------------------------------------------------------ publishing

  /**
   * The engine calls this and nothing else. Routing lives here so a network with
   * one endpoint for every shape only implements publishTextPost.
   */
  async publish(ctx: PublishContext): Promise<PublishResult> {
    const hasVideo = ctx.post.media.some((m) => m.type === 'VIDEO');
    if (hasVideo) return this.publishVideoPost(ctx);
    if (ctx.post.media.length > 0) return this.publishMediaPost(ctx);
    return this.publishTextPost(ctx);
  }

  abstract publishTextPost(ctx: PublishContext): Promise<PublishResult>;
  abstract publishMediaPost(ctx: PublishContext): Promise<PublishResult>;
  abstract publishVideoPost(ctx: PublishContext): Promise<PublishResult>;

  abstract getPost(account: DecryptedAccount, platformPostId: string): Promise<PlatformPostStatus>;

  async deletePost(_account: DecryptedAccount, _platformPostId: string): Promise<void> {
    throw new PlatformError({
      platform: this.platform,
      code: 'UNSUPPORTED',
      message: `${this.label} does not allow Bridge88 to delete posts. Remove it in ${this.label} directly.`,
    });
  }

  // ------------------------------------------------------------ analytics

  async getPostAnalytics(_account: DecryptedAccount, _platformPostId: string): Promise<PostMetrics> {
    return {};
  }

  async getAccountAnalytics(_account: DecryptedAccount): Promise<AccountMetrics> {
    return {};
  }

  /** Guard used by adapters before touching the network. */
  protected requireToken(account: DecryptedAccount): string {
    if (!account.accessToken) {
      throw new PlatformError({
        platform: this.platform,
        code: 'AUTH',
        needsReconnect: true,
        message: `${this.label} authorization is missing. Reconnect ${this.label} to continue publishing.`,
      });
    }
    return account.accessToken;
  }
}

/** Caption as the network will see it: body text plus appended hashtags. */
export function composeText(post: OutgoingPost): string {
  const tags = post.hashtags.filter(Boolean).map((h) => (h.startsWith('#') ? h : `#${h}`));
  return tags.length ? `${post.text}\n\n${tags.join(' ')}`.trim() : post.text;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function describeType(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'JPG',
    'image/png': 'PNG',
    'image/webp': 'WebP',
    'image/gif': 'GIF',
    'video/mp4': 'MP4',
    'video/quicktime': 'MOV',
    'video/webm': 'WebM',
  };
  return map[mime] ?? mime.split('/')[1]?.toUpperCase() ?? mime;
}
