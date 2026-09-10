import { Platform } from '@prisma/client';
import type { SocialAccount } from '@prisma/client';
import { InstagramAdapter } from '@/lib/social/adapters/instagram';
import { FacebookAdapter } from '@/lib/social/adapters/facebook';
import { LinkedInAdapter } from '@/lib/social/adapters/linkedin';
import { XAdapter } from '@/lib/social/adapters/x';
import { TikTokAdapter } from '@/lib/social/adapters/tiktok';
import { YouTubeAdapter } from '@/lib/social/adapters/youtube';
import { MockAdapter } from '@/lib/social/adapters/mock';
import { CAPABILITIES } from '@/lib/social/capabilities';
import { PLATFORM_ICON, PLATFORM_LABELS } from '@/lib/social/labels';
import type { SocialPlatformAdapter } from '@/lib/social/types';

export { PLATFORM_ICON, PLATFORM_LABELS };

/**
 * The registry is the only place that knows which class serves which network.
 * Adding Pinterest, Threads or Bluesky is: write the adapter, add one line here.
 * Nothing in the scheduler, the composer or the publishing engine changes.
 */
const REGISTRY: Record<Platform, () => SocialPlatformAdapter> = {
  INSTAGRAM: () => new InstagramAdapter(),
  FACEBOOK: () => new FacebookAdapter(),
  LINKEDIN: () => new LinkedInAdapter(),
  X: () => new XAdapter(),
  TIKTOK: () => new TikTokAdapter(),
  YOUTUBE: () => new YouTubeAdapter(),
  MOCK: () => new MockAdapter(),
};

export const PLATFORMS: Platform[] = [
  Platform.INSTAGRAM,
  Platform.FACEBOOK,
  Platform.LINKEDIN,
  Platform.X,
  Platform.TIKTOK,
  Platform.YOUTUBE,
];

/** The adapter that owns a network's OAuth flow. */
export function getAdapter(platform: Platform): SocialPlatformAdapter {
  return REGISTRY[platform]();
}

/**
 * The adapter that should serve a *stored* account.
 *
 * A demo channel keeps its real platform on the row — so the composer previews,
 * validates and reports it as Instagram or LinkedIn — while its traffic is
 * served by the mock. That is what lets the whole product be exercised without
 * a single third-party credential.
 */
export function getAdapterForAccount(account: Pick<SocialAccount, 'platform' | 'metadata'>): SocialPlatformAdapter {
  if (isDemoAccount(account)) return new MockAdapter(account.platform);
  return getAdapter(account.platform);
}

export function isDemoAccount(account: Pick<SocialAccount, 'metadata'>): boolean {
  const meta = account.metadata as Record<string, unknown> | null;
  return Boolean(meta && meta.mock === true);
}

export interface PlatformInfo {
  platform: Platform;
  label: string;
  configured: boolean;
  approvalRequired?: string;
  maxTextLength: number;
  requiresMedia: boolean;
}

/** Drives the Connect dialog: what exists, and what this deployment can use. */
export function describePlatforms(): PlatformInfo[] {
  return PLATFORMS.map((platform) => {
    const adapter = getAdapter(platform);
    return {
      platform,
      label: adapter.label,
      configured: adapter.isConfigured(),
      approvalRequired: CAPABILITIES[platform].approvalRequired,
      maxTextLength: CAPABILITIES[platform].maxTextLength,
      requiresMedia: CAPABILITIES[platform].requiresMedia,
    };
  });
}

