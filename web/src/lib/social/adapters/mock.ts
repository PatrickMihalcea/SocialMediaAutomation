import { Platform } from '@prisma/client';
import { BaseAdapter } from '@/lib/social/base';
import { CAPABILITIES } from '@/lib/social/capabilities';
import { PlatformError } from '@/lib/social/errors';
import type {
  AccountMetrics,
  AuthorizationRequest,
  ConnectionResult,
  DecryptedAccount,
  PlatformCapabilities,
  PlatformPostStatus,
  PlatformProfile,
  PostMetrics,
  PublishContext,
  PublishResult,
} from '@/lib/social/types';

/**
 * The development channel.
 *
 * Every other adapter needs credentials and, in most cases, platform review
 * before it will publish anything. This one implements the same interface with
 * no network at all, so the whole product — compose, validate, queue, publish,
 * retry, measure — can be exercised end to end on a laptop.
 *
 * It is a first-class adapter, not a stub: it enforces the same validation, it
 * fails when told to, and its metrics are deterministic so tests can assert on
 * them.
 *
 * `metadata.simulate` on the account drives failure behaviour:
 *   "flaky"    — fails the first attempt with a retryable error, then succeeds
 *   "expired"  — always fails as needing reconnection
 *   "rejected" — always fails permanently
 */
export class MockAdapter extends BaseAdapter {
  readonly platform = Platform.MOCK;

  /** The network this demo channel is pretending to be, for previews and limits. */
  private readonly impersonates: Platform;

  constructor(impersonates: Platform = Platform.MOCK) {
    super();
    this.impersonates = impersonates;
  }

  get capabilities(): PlatformCapabilities {
    return CAPABILITIES[this.impersonates];
  }

  get label(): string {
    return this.impersonates === Platform.MOCK ? 'Demo channel' : `${this.impersonates} (demo)`;
  }

  isConfigured(): boolean {
    return true;
  }

  async getAuthorizationUrl(input: { redirectUri: string; state: string }): Promise<AuthorizationRequest> {
    // Loops straight back to the callback: there is no third party to visit.
    const url = new URL(input.redirectUri);
    url.searchParams.set('code', `mock-code-${input.state}`);
    url.searchParams.set('state', input.state);
    return { url: url.toString() };
  }

  async exchangeCode(input: { code: string }): Promise<ConnectionResult[]> {
    const suffix = input.code.slice(-6);
    return [
      {
        externalAccountId: `mock-${suffix}`,
        accountName: 'Demo channel',
        accountHandle: '@demo',
        accessToken: `mock-access-${suffix}`,
        refreshToken: `mock-refresh-${suffix}`,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60),
        scopes: ['read', 'publish', 'analytics'],
        metadata: { mock: true },
      },
    ];
  }

  async getAccount(account: DecryptedAccount): Promise<PlatformProfile> {
    this.simulateFailure(account, 'read');
    return {
      externalAccountId: account.externalAccountId,
      accountName: account.accountName,
      accountHandle: (account.metadata.handle as string) ?? '@demo',
      followers: seededInt(account.id, 'followers', 1200, 48_000),
      following: seededInt(account.id, 'following', 80, 900),
      metadata: { mock: true },
    };
  }

  async publishTextPost(ctx: PublishContext): Promise<PublishResult> {
    return this.simulatePublish(ctx);
  }

  async publishMediaPost(ctx: PublishContext): Promise<PublishResult> {
    return this.simulatePublish(ctx);
  }

  async publishVideoPost(ctx: PublishContext): Promise<PublishResult> {
    return this.simulatePublish(ctx);
  }

  private async simulatePublish(ctx: PublishContext): Promise<PublishResult> {
    this.simulateFailure(ctx.account, 'publish', ctx.idempotencyKey);
    // The id is derived from the idempotency key, so a duplicate publish call
    // produces the same id — the same guarantee a well-behaved network gives.
    const platformPostId = `mock_${hash(ctx.idempotencyKey).slice(0, 16)}`;
    return {
      platformPostId,
      url: `https://demo.bridge88.local/p/${platformPostId}`,
      publishedAt: new Date(),
      raw: { mock: true, characters: ctx.post.text.length, media: ctx.post.media.length },
    };
  }

  async getPost(_account: DecryptedAccount, platformPostId: string): Promise<PlatformPostStatus> {
    return {
      platformPostId,
      exists: true,
      url: `https://demo.bridge88.local/p/${platformPostId}`,
      publishedAt: new Date(),
    };
  }

  async deletePost(): Promise<void> {}

  async getPostAnalytics(_account: DecryptedAccount, platformPostId: string): Promise<PostMetrics> {
    const impressions = seededInt(platformPostId, 'impr', 400, 24_000);
    const reach = Math.round(impressions * 0.72);
    const likes = Math.round(impressions * (seededInt(platformPostId, 'lr', 15, 70) / 1000));
    return {
      impressions,
      reach,
      likes,
      comments: Math.max(0, Math.round(likes * 0.08)),
      shares: Math.max(0, Math.round(likes * 0.05)),
      saves: Math.max(0, Math.round(likes * 0.11)),
      clicks: Math.round(impressions * 0.012),
      videoViews: null,
      raw: { mock: true },
    };
  }

  async getAccountAnalytics(account: DecryptedAccount): Promise<AccountMetrics> {
    const followers = seededInt(account.id, 'followers', 1200, 48_000);
    return {
      followers,
      following: seededInt(account.id, 'following', 80, 900),
      impressions: seededInt(account.id, 'accimpr', 5_000, 180_000),
      reach: seededInt(account.id, 'accreach', 4_000, 120_000),
      profileViews: seededInt(account.id, 'views', 200, 9_000),
      engagements: seededInt(account.id, 'eng', 100, 6_000),
      raw: { mock: true },
    };
  }

  /** Attempt counter for the "flaky" simulation, keyed by idempotency key. */
  private static attempts = new Map<string, number>();

  private simulateFailure(account: DecryptedAccount, phase: 'read' | 'publish', key?: string): void {
    const mode = account.metadata?.simulate as string | undefined;
    if (!mode) return;

    if (mode === 'expired') {
      throw new PlatformError({
        platform: this.platform,
        code: 'AUTH',
        needsReconnect: true,
        message: 'Demo channel authorization expired. Reconnect it to continue publishing.',
      });
    }
    if (mode === 'rejected' && phase === 'publish') {
      throw new PlatformError({
        platform: this.platform,
        code: 'REJECTED',
        message: 'The demo channel rejected this post. This channel is set to always fail.',
      });
    }
    if (mode === 'flaky' && phase === 'publish' && key) {
      const seen = (MockAdapter.attempts.get(key) ?? 0) + 1;
      MockAdapter.attempts.set(key, seen);
      if (seen === 1) {
        throw new PlatformError({
          platform: this.platform,
          code: 'UPSTREAM',
          retryable: true,
          message: 'The demo channel is unavailable right now. Bridge88 will try again.',
        });
      }
    }
  }
}

/** Stable pseudo-random integer so demo numbers do not shuffle on every render. */
function seededInt(seed: string, salt: string, min: number, max: number): number {
  const h = hash(`${seed}:${salt}`);
  const n = parseInt(h.slice(0, 8), 16) / 0xffffffff;
  return Math.round(min + n * (max - min));
}

function hash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (((h2 >>> 0) * 4294967296 + (h1 >>> 0)) >>> 0).toString(16).padStart(8, '0').repeat(3);
}
