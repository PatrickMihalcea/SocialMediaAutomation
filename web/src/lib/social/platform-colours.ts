import type { Platform } from '@prisma/client';

/** Each network's colour in charts, from the Bridge88 pastel blocks. */
export const PLATFORM_COLOURS: Record<Platform, string> = {
  INSTAGRAM: 'var(--block-pink)',
  FACEBOOK: 'var(--block-lilac)',
  YOUTUBE: 'var(--block-coral)',
  TIKTOK: 'var(--block-mint)',
  X: 'var(--block-cream)',
  LINKEDIN: 'var(--block-lime)',
  MOCK: 'var(--surface-soft)',
};
