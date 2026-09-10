import type { Platform } from '@prisma/client';

/**
 * Display names and glyph keys. Kept out of `registry.ts` so client components
 * can label channels without pulling OAuth adapters (and `server-only` env).
 */
export const PLATFORM_LABELS: Record<Platform, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  LINKEDIN: 'LinkedIn',
  X: 'X',
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  MOCK: 'Demo',
};

export const PLATFORM_ICON: Record<Platform, string> = {
  INSTAGRAM: 'camera',
  FACEBOOK: 'users',
  LINKEDIN: 'briefcase',
  X: 'message-square',
  TIKTOK: 'music',
  YOUTUBE: 'play',
  MOCK: 'circle-dot',
};
