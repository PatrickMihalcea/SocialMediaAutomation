import type { Platform, SocialAccount } from '@prisma/client';

/**
 * The contract every network implements. The publishing engine talks only to
 * this interface — it has no knowledge of Graph API edges, LinkedIn UGC posts or
 * TikTok's chunked upload. Adding Pinterest or Bluesky later means writing one
 * adapter and registering it; the scheduler does not change.
 */

export interface PlatformCapabilities {
  /** Hard character ceiling the network enforces on post text. */
  maxTextLength: number;
  maxImages: number;
  maxVideos: number;
  /** Some networks reject mixed image+video in one post. */
  allowsMixedMedia: boolean;
  requiresMedia: boolean;
  supportsFirstComment: boolean;
  supportsLink: boolean;
  supportsAltText: boolean;
  supportsScheduling: boolean;
  supportsDelete: boolean;
  supportsPostAnalytics: boolean;
  supportsAccountAnalytics: boolean;
  /** Metrics the network actually reports. Anything absent renders as "not reported". */
  reportedMetrics: MetricKey[];
  image: MediaConstraints;
  video: VideoConstraints;
  /** Set when the integration needs platform review before it will work in production. */
  approvalRequired?: string;
}

export type MetricKey =
  | 'impressions'
  | 'reach'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'saves'
  | 'clicks'
  | 'videoViews';

export interface MediaConstraints {
  mimeTypes: string[];
  maxBytes: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Inclusive width/height ratio band, e.g. [0.8, 1.91] for an Instagram feed image. */
  aspectRatio?: [number, number];
}

export interface VideoConstraints extends MediaConstraints {
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
}

// ---------------------------------------------------------------- oauth

export interface AuthorizationRequest {
  url: string;
  /** PKCE verifier, when the network uses it. Stored in an httpOnly cookie. */
  codeVerifier?: string;
}

export interface ConnectionResult {
  externalAccountId: string;
  accountName: string;
  accountHandle?: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
  metadata?: Record<string, unknown>;
}

export interface RefreshedToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface AccountValidation {
  valid: boolean;
  /** Written for the person reading the channels page, not for a log. */
  message?: string;
  needsReconnect?: boolean;
}

export interface PlatformProfile {
  externalAccountId: string;
  accountName: string;
  accountHandle?: string;
  avatarUrl?: string;
  followers?: number;
  following?: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------- publishing

export interface OutgoingMedia {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'GIF' | 'AUDIO';
  mimeType: string;
  filename: string;
  size: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  altText: string | null;
  /** Time-limited URL the platform can fetch the bytes from. */
  url: string;
  /** Reads the bytes directly, for networks that require an upload rather than a URL. */
  read: () => Promise<Buffer>;
}

export interface OutgoingPost {
  text: string;
  media: OutgoingMedia[];
  firstComment?: string | null;
  link?: string | null;
  hashtags: string[];
  mentions: string[];
  title?: string | null;
}

export interface PublishContext {
  account: DecryptedAccount;
  post: OutgoingPost;
  /**
   * Stable per (post, channel). Adapters that can pass a client-side dedupe key
   * to the network do so; the engine also records it, so a retry after an
   * ambiguous failure can check before re-sending.
   */
  idempotencyKey: string;
}

export interface PublishResult {
  platformPostId: string;
  url?: string;
  publishedAt: Date;
  raw?: Record<string, unknown>;
}

export interface PlatformPostStatus {
  platformPostId: string;
  exists: boolean;
  url?: string;
  publishedAt?: Date;
}

/** A SocialAccount with its tokens decrypted, produced only inside the server. */
export interface DecryptedAccount {
  id: string;
  workspaceId: string;
  platform: Platform;
  externalAccountId: string;
  accountName: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------- validation

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  /** Machine-readable reason, used by tests and by the composer to place the message. */
  code: string;
  /** Shown verbatim in the composer. Plain sentence, no error codes. */
  message: string;
  field?: 'text' | 'media' | 'link' | 'firstComment' | 'schedule' | 'account';
  mediaId?: string;
}

// ---------------------------------------------------------------- analytics

export interface PostMetrics {
  impressions?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  clicks?: number | null;
  videoViews?: number | null;
  raw?: Record<string, unknown>;
}

export interface AccountMetrics {
  followers?: number | null;
  following?: number | null;
  impressions?: number | null;
  reach?: number | null;
  profileViews?: number | null;
  engagements?: number | null;
  raw?: Record<string, unknown>;
}

// ---------------------------------------------------------------- adapter

export interface SocialPlatformAdapter {
  readonly platform: Platform;
  readonly label: string;
  readonly capabilities: PlatformCapabilities;

  /** False when the deployment has no credentials for this network. */
  isConfigured(): boolean;

  // connection lifecycle
  getAuthorizationUrl(input: { redirectUri: string; state: string }): Promise<AuthorizationRequest>;
  exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<ConnectionResult[]>;
  refreshToken(account: DecryptedAccount): Promise<RefreshedToken | null>;
  validateAccount(account: DecryptedAccount): Promise<AccountValidation>;
  getAccount(account: DecryptedAccount): Promise<PlatformProfile>;
  disconnect(account: DecryptedAccount): Promise<void>;

  // content
  validatePost(post: OutgoingPost): ValidationIssue[];
  publish(ctx: PublishContext): Promise<PublishResult>;
  publishTextPost(ctx: PublishContext): Promise<PublishResult>;
  publishMediaPost(ctx: PublishContext): Promise<PublishResult>;
  publishVideoPost(ctx: PublishContext): Promise<PublishResult>;
  getPost(account: DecryptedAccount, platformPostId: string): Promise<PlatformPostStatus>;
  deletePost(account: DecryptedAccount, platformPostId: string): Promise<void>;

  // measurement
  getPostAnalytics(account: DecryptedAccount, platformPostId: string): Promise<PostMetrics>;
  getAccountAnalytics(account: DecryptedAccount): Promise<AccountMetrics>;
}

export type SocialAccountRow = SocialAccount;
