import type { AiMediaJobKind, JobStatus } from '@prisma/client';

export const AI_MEDIA_JOB_LABELS: Record<AiMediaJobKind, string> = {
  IMAGE_GENERATE: 'Generated image',
  IMAGE_EDIT: 'Edited image',
  IMAGE_VARIATION: 'Image variation',
  VIDEO_GENERATE: 'Generated video',
  VIDEO_ANIMATE: 'Animated image',
  AUDIO_TTS: 'Spoken audio',
  AUDIO_TRANSCRIBE: 'Audio transcription',
  AUDIO_TRANSLATE: 'Audio translation',
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  QUEUED: 'Waiting',
  RUNNING: 'Processing',
  COMPLETED: 'Ready',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};
