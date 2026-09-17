import 'server-only';
import type { JobPayloadMap, JobType } from '@/lib/queue/types';

/**
 * Job type → handler. Imports are dynamic so the web process, which only ever
 * enqueues, does not pull sharp, the adapters and the publishing engine into
 * every request.
 */
type Handler = (payload: never) => Promise<unknown>;

const HANDLERS: { [K in JobType]: () => Promise<(payload: JobPayloadMap[K]) => Promise<unknown>> } = {
  'publish-post': async () => {
    const { publishPost } = await import('@/lib/publishing/engine');
    return (payload) => publishPost(payload.postId);
  },
  'publish-post-platform': async () => {
    const { publishPostPlatform } = await import('@/lib/publishing/engine');
    return (p) => publishPostPlatform(p.postPlatformId);
  },
  'process-media': async () => {
    const { processMediaAsset } = await import('@/lib/media/process');
    return (p) => processMediaAsset(p.mediaAssetId);
  },
  'generate-thumbnail': async () => {
    const { processMediaAsset } = await import('@/lib/media/process');
    return (p) => processMediaAsset(p.mediaAssetId);
  },
  'sync-account-analytics': async () => {
    const { syncAccountAnalytics } = await import('@/lib/analytics/sync');
    return (p) => syncAccountAnalytics(p.socialAccountId);
  },
  'sync-post-analytics': async () => {
    const { syncPostAnalytics } = await import('@/lib/analytics/sync');
    return (p) => syncPostAnalytics(p.postPlatformId);
  },
  'sync-workspace-analytics': async () => {
    const { syncWorkspaceAnalytics } = await import('@/lib/analytics/sync');
    return (p) => syncWorkspaceAnalytics(p.workspaceId);
  },
  'expand-recurrence': async () => {
    const { expandRecurrence } = await import('@/lib/scheduling/recurrence');
    return (p) => expandRecurrence(p.recurringScheduleId);
  },
  'scan-due-posts': async () => {
    const { scanDuePosts } = await import('@/lib/publishing/engine');
    return () => scanDuePosts();
  },
  'send-notification-email': async () => {
    const { sendNotificationEmail } = await import('@/lib/notifications/email');
    return (p) => sendNotificationEmail(p.notificationId);
  },
  'ai-media-job': async () => {
    const { runAiMediaJob } = await import('@/lib/ai/media-jobs');
    return (p) => runAiMediaJob(p.aiMediaJobId);
  },
  'run-workflow-node': async () => {
    const { runWorkflowNode } = await import('@/lib/workflows/engine');
    return (p) => runWorkflowNode(p.nodeRunId);
  },
  'sweep-workflow-runs': async () => {
    const { sweepWorkflowRuns } = await import('@/lib/workflows/engine');
    return () => sweepWorkflowRuns();
  },
  'scan-due-workflows': async () => {
    const { scanDueWorkflows } = await import('@/lib/workflows/schedule');
    return () => scanDueWorkflows();
  },
  'analyse-audio': async () => {
    const { analyseAudioAsset } = await import('@/lib/audio/analyse');
    return (p) => analyseAudioAsset(p.mediaAssetId);
  },
};

const cache = new Map<JobType, Handler>();

export function getHandler(type: JobType): Handler | null {
  if (!(type in HANDLERS)) return null;
  const cached = cache.get(type);
  if (cached) return cached;

  const handler: Handler = async (payload) => {
    const fn = await HANDLERS[type]();
    return (fn as (p: unknown) => Promise<unknown>)(payload);
  };
  cache.set(type, handler);
  return handler;
}
