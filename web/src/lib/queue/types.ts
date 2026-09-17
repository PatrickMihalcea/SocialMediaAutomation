import type { QueueName } from '@prisma/client';

/**
 * Every job type in the system, with its payload. The map is the contract
 * between whoever enqueues and whoever handles — adding a job type without
 * adding it here is a type error at both ends.
 */
export interface JobPayloadMap {
  'publish-post': { postId: string };
  'publish-post-platform': { postPlatformId: string };
  'process-media': { mediaAssetId: string };
  'generate-thumbnail': { mediaAssetId: string };
  'sync-account-analytics': { socialAccountId: string };
  'sync-post-analytics': { postPlatformId: string };
  'sync-workspace-analytics': { workspaceId: string };
  'expand-recurrence': { recurringScheduleId: string };
  'scan-due-posts': Record<string, never>;
  'send-notification-email': { notificationId: string };
  /** One node's execution inside a workflow run. */
  'run-workflow-node': { nodeRunId: string };
  /** Repairs runs a dying worker left mid-flight. */
  'sweep-workflow-runs': Record<string, never>;
  /** Starts every workflow whose weekly slot has arrived. */
  'scan-due-workflows': Record<string, never>;
  /** Beat-grid analysis for an uploaded audio asset. */
  'analyse-audio': { mediaAssetId: string };
  'ai-media-job': { aiMediaJobId: string };
  /** Renders a chosen track onto an image or video as its only audio. */
  'mux-audio': { mediaAssetId: string };
}

export type JobType = keyof JobPayloadMap;

export const JOB_QUEUE: Record<JobType, QueueName> = {
  'publish-post': 'POST_PUBLISHING',
  'publish-post-platform': 'POST_PUBLISHING',
  'process-media': 'MEDIA_PROCESSING',
  'generate-thumbnail': 'THUMBNAIL_GENERATION',
  'sync-account-analytics': 'ANALYTICS_SYNC',
  'sync-post-analytics': 'ANALYTICS_SYNC',
  'sync-workspace-analytics': 'ANALYTICS_SYNC',
  'expand-recurrence': 'POST_PUBLISHING',
  'scan-due-posts': 'POST_PUBLISHING',
  'send-notification-email': 'NOTIFICATION',
  // Workflow steps get their own lane: a render pegs a core for minutes, and
  // sharing POST_PUBLISHING would let one video starve every scheduled post.
  'run-workflow-node': 'WORKFLOW',
  'sweep-workflow-runs': 'WORKFLOW',
  'scan-due-workflows': 'WORKFLOW',
  'analyse-audio': 'MEDIA_PROCESSING',
  'ai-media-job': 'AI_GENERATION',
  'mux-audio': 'MEDIA_PROCESSING',
};

export interface EnqueueOptions {
  workspaceId?: string | null;
  /** Earliest run time. Used for retry backoff and for future-dated work. */
  runAt?: Date;
  maxAttempts?: number;
  /**
   * Collapses duplicates: enqueueing the same key twice while the first is still
   * pending is a no-op. This is what stops the due-post scanner from queueing a
   * post twice if it runs while the first job is still waiting.
   */
  dedupeKey?: string;
}

export interface QueueDriver {
  readonly name: 'in-process' | 'bullmq';
  enqueue<T extends JobType>(type: T, payload: JobPayloadMap[T], options?: EnqueueOptions): Promise<string>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Exponential backoff with a ceiling, so a broken integration stops hammering. */
export function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 5_000, 30 * 60 * 1000);
}
