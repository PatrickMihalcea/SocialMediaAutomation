import type { MediaStatus, MediaType } from '@prisma/client';

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  IMAGE: 'Image',
  VIDEO: 'Video',
  GIF: 'Animated image',
  AUDIO: 'Audio',
};

export const MEDIA_STATUS_LABELS: Record<MediaStatus, string> = {
  UPLOADING: 'Uploading',
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Needs attention',
};

export const MEDIA_KIND_LABELS = {
  ORIGINAL: 'Original',
  DERIVATIVE: 'Edited version',
  GENERATED: 'AI generated',
} as const;
