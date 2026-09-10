import type { PostPlatformStatus, PostStatus, Prisma } from '@prisma/client';
import { invalid } from '@/lib/errors';

export type PostLifecycleAction =
  | 'edit'
  | 'submitForApproval'
  | 'schedule'
  | 'publish'
  | 'retry'
  | 'reschedule'
  | 'cancel'
  | 'restore'
  | 'duplicate'
  | 'delete';

const ACTIONS_BY_STATUS: Record<PostStatus, readonly PostLifecycleAction[]> = {
  DRAFT: ['edit', 'submitForApproval', 'schedule', 'publish', 'duplicate', 'delete'],
  PENDING_APPROVAL: ['edit', 'duplicate', 'delete'],
  APPROVED: ['edit', 'schedule', 'publish', 'duplicate', 'delete'],
  SCHEDULED: ['edit', 'publish', 'reschedule', 'cancel', 'duplicate', 'delete'],
  PUBLISHING: ['duplicate'],
  PUBLISHED: ['edit', 'duplicate', 'delete'],
  FAILED: ['edit', 'retry', 'reschedule', 'cancel', 'duplicate', 'delete'],
  CANCELLED: ['restore', 'publish', 'duplicate', 'delete'],
};

export function legalPostActions(status: PostStatus): readonly PostLifecycleAction[] {
  return ACTIONS_BY_STATUS[status];
}

export function isPostActionLegal(status: PostStatus, action: PostLifecycleAction): boolean {
  return ACTIONS_BY_STATUS[status].includes(action);
}

export type ComposerContextDefaults = {
  scheduledAt?: string;
  campaignId?: string;
  assetId?: string;
};

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseComposerContext(
  query: { scheduledAt?: string; campaign?: string; asset?: string },
  available: { campaignIds: readonly string[]; assetIds: readonly string[] },
  now = new Date(),
): ComposerContextDefaults {
  const result: ComposerContextDefaults = {};
  if (query.scheduledAt && isSafeLocalDateTime(query.scheduledAt, now)) {
    result.scheduledAt = query.scheduledAt;
  }
  if (
    query.campaign &&
    UUID.test(query.campaign) &&
    available.campaignIds.includes(query.campaign)
  ) {
    result.campaignId = query.campaign;
  }
  if (
    query.asset &&
    UUID.test(query.asset) &&
    available.assetIds.includes(query.asset)
  ) {
    result.assetId = query.asset;
  }
  return result;
}

function isSafeLocalDateTime(value: string, now: Date): boolean {
  const match = LOCAL_DATETIME.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return false;
  }
  return year >= now.getUTCFullYear() - 1 && year <= now.getUTCFullYear() + 5;
}

type RescheduleTransaction = Pick<Prisma.TransactionClient, 'post' | 'postPlatform'>;

export async function applyGuardedReschedule(
  tx: RescheduleTransaction,
  input: {
    postId: string;
    workspaceId: string;
    scheduledAt: Date;
    timezone: string;
  },
) {
  const result = await tx.post.updateMany({
    where: {
      id: input.postId,
      workspaceId: input.workspaceId,
      status: { notIn: ['PUBLISHED', 'PUBLISHING'] },
    },
    data: {
      status: 'SCHEDULED',
      scheduledAt: input.scheduledAt,
      timezone: input.timezone,
    },
  });
  if (result.count !== 1) {
    throw invalid(
      'This post started publishing while its date was being changed. Its publishing time was left unchanged.',
    );
  }
  await tx.postPlatform.updateMany({
    where: {
      postId: input.postId,
      workspaceId: input.workspaceId,
      status: { in: ['FAILED', 'CANCELLED'] satisfies PostPlatformStatus[] },
    },
    data: { status: 'PENDING', errorMessage: null, errorCode: null },
  });
}

export async function applyCancelledRestore(
  tx: RescheduleTransaction,
  input: { postId: string; workspaceId: string },
) {
  const result = await tx.post.updateMany({
    where: {
      id: input.postId,
      workspaceId: input.workspaceId,
      status: 'CANCELLED',
    },
    data: { status: 'DRAFT', scheduledAt: null },
  });
  if (result.count !== 1) {
    throw invalid('This post is no longer cancelled. Refresh to see its current status.');
  }
  await tx.postPlatform.updateMany({
    where: { postId: input.postId, workspaceId: input.workspaceId, status: 'CANCELLED' },
    data: { status: 'PENDING', errorMessage: null, errorCode: null },
  });
}

const FRIENDLY_FAILURES: Record<string, string> = {
  AUTH: 'Reconnect this channel, then retry publishing.',
  DISCONNECTED: 'Reconnect this channel, then retry publishing.',
  RATE_LIMIT: 'The channel temporarily limited publishing. Retry shortly.',
  RATE_LIMITED: 'The channel temporarily limited publishing. Retry shortly.',
  TIMEOUT: 'The channel did not finish in time. Retry publishing.',
  NETWORK: 'Bridge88 could not reach the channel. Retry publishing.',
  UPSTREAM: 'The channel is temporarily unavailable. Retry publishing.',
  BAD_RESPONSE: 'The channel returned an unreadable response. Retry publishing.',
  MEDIA_REQUIRED: 'Add the media this channel requires, then retry.',
  MEDIA_REJECTED: 'The channel could not process this media. Replace it and retry.',
  REJECTED: 'The channel rejected the post. Review its copy and media, then retry.',
  PUBLISH_FAILED: 'The channel could not publish the post. Review it and retry.',
  NOT_CONFIGURED: 'This channel is not configured for publishing.',
  UNKNOWN: 'Bridge88 could not determine the cause. Retry publishing.',
};

export function friendlyPublishFailure(errorCode: string | null): string {
  return FRIENDLY_FAILURES[errorCode ?? 'UNKNOWN'] ?? FRIENDLY_FAILURES.UNKNOWN;
}
