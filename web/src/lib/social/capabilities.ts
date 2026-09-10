import type { Platform } from '@prisma/client';
import type { PlatformCapabilities } from '@/lib/social/types';

const MB = (n: number) => n * 1024 * 1024;
const GB = (n: number) => n * 1024 * 1024 * 1024;

/**
 * Published limits for each network, in one table so the composer, the queue and
 * the adapters all validate against the same numbers. These track the public API
 * documentation and are the values a deployment is most likely to need to revise
 * — networks change them without warning, so keep this file under review.
 */
export const CAPABILITIES: Record<Platform, PlatformCapabilities> = {
  INSTAGRAM: {
    maxTextLength: 2200,
    maxImages: 10,
    maxVideos: 1,
    allowsMixedMedia: true, // carousels may mix, single posts may not
    requiresMedia: true,
    supportsFirstComment: true,
    supportsLink: false, // captions do not linkify
    supportsAltText: true,
    supportsScheduling: false,
    supportsDelete: false,
    supportsPostAnalytics: true,
    supportsAccountAnalytics: true,
    reportedMetrics: ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves'],
    image: {
      mimeTypes: ['image/jpeg', 'image/png'],
      maxBytes: MB(8),
      minWidth: 320,
      minHeight: 320,
      maxWidth: 1440,
      aspectRatio: [0.8, 1.91],
    },
    video: {
      mimeTypes: ['video/mp4', 'video/quicktime'],
      maxBytes: GB(1),
      minWidth: 540,
      minHeight: 540,
      minDurationSeconds: 3,
      maxDurationSeconds: 900,
      aspectRatio: [0.01, 1.91],
    },
    approvalRequired:
      'Publishing needs a Meta app with instagram_content_publish, an Instagram Business or Creator account linked to a Facebook Page, and Meta App Review.',
  },

  FACEBOOK: {
    maxTextLength: 63_206,
    maxImages: 10,
    maxVideos: 1,
    allowsMixedMedia: false,
    requiresMedia: false,
    supportsFirstComment: true,
    supportsLink: true,
    supportsAltText: true,
    supportsScheduling: true,
    supportsDelete: true,
    supportsPostAnalytics: true,
    supportsAccountAnalytics: true,
    reportedMetrics: ['impressions', 'reach', 'likes', 'comments', 'shares', 'clicks', 'videoViews'],
    image: { mimeTypes: ['image/jpeg', 'image/png', 'image/gif'], maxBytes: MB(10) },
    video: {
      mimeTypes: ['video/mp4', 'video/quicktime'],
      maxBytes: GB(10),
      minDurationSeconds: 1,
      maxDurationSeconds: 14_400,
    },
    approvalRequired:
      'Needs a Meta app with pages_manage_posts and pages_read_engagement, plus Meta App Review for production use.',
  },

  LINKEDIN: {
    maxTextLength: 3000,
    maxImages: 20,
    maxVideos: 1,
    allowsMixedMedia: false,
    requiresMedia: false,
    supportsFirstComment: true,
    supportsLink: true,
    supportsAltText: true,
    supportsScheduling: false,
    supportsDelete: true,
    supportsPostAnalytics: true,
    supportsAccountAnalytics: true,
    reportedMetrics: ['impressions', 'likes', 'comments', 'shares', 'clicks'],
    image: { mimeTypes: ['image/jpeg', 'image/png', 'image/gif'], maxBytes: MB(10) },
    video: {
      mimeTypes: ['video/mp4'],
      maxBytes: GB(5),
      minDurationSeconds: 3,
      maxDurationSeconds: 1800,
    },
    approvalRequired:
      'Organization posting needs the Community Management API, which LinkedIn grants per application.',
  },

  X: {
    maxTextLength: 280,
    maxImages: 4,
    maxVideos: 1,
    allowsMixedMedia: false,
    requiresMedia: false,
    supportsFirstComment: true, // posted as a reply in the same thread
    supportsLink: true,
    supportsAltText: true,
    supportsScheduling: false,
    supportsDelete: true,
    supportsPostAnalytics: true,
    supportsAccountAnalytics: true,
    reportedMetrics: ['impressions', 'likes', 'comments', 'shares', 'clicks', 'videoViews'],
    image: { mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxBytes: MB(5) },
    video: {
      mimeTypes: ['video/mp4'],
      maxBytes: MB(512),
      minDurationSeconds: 0.5,
      maxDurationSeconds: 140,
    },
    approvalRequired: 'Write access requires a paid X API tier.',
  },

  TIKTOK: {
    maxTextLength: 2200,
    maxImages: 35,
    maxVideos: 1,
    allowsMixedMedia: false,
    requiresMedia: true,
    supportsFirstComment: false,
    supportsLink: false,
    supportsAltText: false,
    supportsScheduling: false,
    supportsDelete: false,
    supportsPostAnalytics: true,
    supportsAccountAnalytics: true,
    reportedMetrics: ['impressions', 'likes', 'comments', 'shares', 'videoViews'],
    image: { mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: MB(20) },
    video: {
      mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
      maxBytes: GB(4),
      minDurationSeconds: 3,
      maxDurationSeconds: 600,
    },
    approvalRequired:
      'The Content Posting API needs TikTok audit approval; unaudited apps can only post to private accounts.',
  },

  YOUTUBE: {
    maxTextLength: 5000, // description
    maxImages: 0,
    maxVideos: 1,
    allowsMixedMedia: false,
    requiresMedia: true,
    supportsFirstComment: true,
    supportsLink: true,
    supportsAltText: false,
    supportsScheduling: true,
    supportsDelete: true,
    supportsPostAnalytics: true,
    supportsAccountAnalytics: true,
    reportedMetrics: ['impressions', 'likes', 'comments', 'shares', 'videoViews'],
    image: { mimeTypes: ['image/jpeg', 'image/png'], maxBytes: MB(2) }, // thumbnail only
    video: {
      mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
      maxBytes: GB(128),
      minDurationSeconds: 1,
      maxDurationSeconds: 43_200,
    },
    approvalRequired:
      'Uploading beyond the unverified quota needs a Google API audit; unaudited projects upload as private only.',
  },

  MOCK: {
    maxTextLength: 5000,
    maxImages: 10,
    maxVideos: 1,
    allowsMixedMedia: true,
    requiresMedia: false,
    supportsFirstComment: true,
    supportsLink: true,
    supportsAltText: true,
    supportsScheduling: true,
    supportsDelete: true,
    supportsPostAnalytics: true,
    supportsAccountAnalytics: true,
    reportedMetrics: ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks', 'videoViews'],
    image: { mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxBytes: MB(25) },
    video: {
      mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
      maxBytes: GB(2),
      maxDurationSeconds: 3600,
    },
  },
};

/** Preset export sizes offered by the media editor. */
export const MEDIA_PRESETS = [
  { id: 'ig-square', label: 'Instagram square', width: 1080, height: 1080 },
  { id: 'ig-portrait', label: 'Instagram portrait', width: 1080, height: 1350 },
  { id: 'vertical', label: 'Instagram / TikTok / Reels', width: 1080, height: 1920 },
  { id: 'youtube', label: 'YouTube', width: 1920, height: 1080 },
  { id: 'linkedin', label: 'LinkedIn link card', width: 1200, height: 627 },
] as const;

export type MediaPresetId = (typeof MEDIA_PRESETS)[number]['id'];
