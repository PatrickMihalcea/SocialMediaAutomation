import type { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';

export const HISTORY_PAGE_SIZE = 25;

export const HISTORY_TYPES = ['post', 'campaign', 'account', 'approval', 'media', 'workspace'] as const;
export type HistoryType = (typeof HISTORY_TYPES)[number];

type RawHistoryFilters = {
  type?: string;
  from?: string;
  to?: string;
  post?: string;
  page?: string;
};

export type HistoryFilters = {
  type?: HistoryType;
  from?: Date;
  to?: Date;
  postId?: string;
  page: number;
  error?: string;
};

const ENTITY_TYPES: Record<HistoryType, string[]> = {
  post: ['post', 'post_platform'],
  campaign: ['campaign'],
  account: ['social_account', 'oauth_attempt'],
  approval: ['approval', 'approval_comment'],
  media: ['media_asset'],
  workspace: ['workspace', 'brand_settings'],
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function parseHistoryFilters(raw: RawHistoryFilters, timezone: string): HistoryFilters {
  const errors: string[] = [];
  const type = HISTORY_TYPES.includes(raw.type as HistoryType) ? raw.type as HistoryType : undefined;
  if (raw.type && !type) errors.push('The activity type filter was not recognized.');

  const from = parseBoundary(raw.from, timezone, 'start', errors);
  const to = parseBoundary(raw.to, timezone, 'end', errors);
  if (from && to && from > to) errors.push('The start date must be before the end date.');

  const postId = raw.post && ID_PATTERN.test(raw.post) ? raw.post : undefined;
  if (raw.post && !postId) errors.push('The post filter was not recognized.');

  const requestedPage = Number(raw.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, 10_000)
    : 1;
  if (raw.page && page === 1 && raw.page !== '1') errors.push('The page number was not recognized.');

  return { type, from, to, postId, page, error: errors[0] };
}

function parseBoundary(
  value: string | undefined,
  timezone: string,
  edge: 'start' | 'end',
  errors: string[],
): Date | undefined {
  if (!value) return undefined;
  if (!DATE_PATTERN.test(value)) {
    errors.push('Use a complete date in year-month-day format.');
    return undefined;
  }
  const local = DateTime.fromISO(value, { zone: timezone });
  if (!local.isValid || local.toFormat('yyyy-MM-dd') !== value) {
    errors.push('One of the selected dates is not valid.');
    return undefined;
  }
  return (edge === 'start' ? local.startOf('day') : local.endOf('day')).toUTC().toJSDate();
}

export function buildAuditWhere(
  workspaceId: string,
  filters: HistoryFilters,
  platformIds: string[] = [],
  approvalIds: string[] = [],
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = { workspaceId };
  if (filters.type) where.entityType = { in: ENTITY_TYPES[filters.type] };
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  if (filters.postId) {
    where.OR = [
      { entityType: 'post', entityId: filters.postId },
      { entityType: 'post_platform', entityId: { in: platformIds } },
      { entityType: { in: ['approval', 'approval_comment'] }, entityId: { in: [filters.postId, ...approvalIds] } },
    ];
  }
  return where;
}

export function formatAuditTimestamp(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function humanizeAuditEvent(input: {
  action: string;
  actor: string;
  entity: string;
  metadata?: unknown;
}): string {
  const { action, actor, entity } = input;
  const metadata = asMetadata(input.metadata);
  const platform = platformLabel(metadata.platform);
  const attempt = typeof metadata.attempt === 'number' ? ` on attempt ${metadata.attempt}` : '';
  const error = friendlyError(metadata.error ?? metadata.message ?? metadata.code);
  const subject = actor === 'Bridge88' ? 'Bridge88' : actor;

  const mapped: Record<string, string> = {
    'post.created': `${subject} created ${entity}.`,
    'post.updated': metadata.status === 'SCHEDULED'
      ? `${subject} scheduled ${entity}.`
      : `${subject} edited ${entity}.`,
    'post.edited': `${subject} edited ${entity}.`,
    'post.duplicated': `${subject} duplicated ${entity}.`,
    'post.scheduled': `${subject} scheduled ${entity}.`,
    'post.rescheduled': `${subject} rescheduled ${entity}.`,
    'post.cancelled': `${subject} cancelled ${entity}.`,
    'post.channel_cancelled': `${subject} cancelled one channel for ${entity}.`,
    'post.campaign_changed': `${subject} changed the campaign for ${entity}.`,
    'post.publish_attempted': `${subject} attempted to publish ${entity}${platform ? ` to ${platform}` : ''}${attempt}.`,
    'post.published': `${subject} published ${entity}${platform ? ` to ${platform}` : ''}.`,
    'post.publish_failed': `${subject} could not publish ${entity}${platform ? ` to ${platform}` : ''}. ${error}`,
    'campaign.created': `${subject} created ${entity}.`,
    'campaign.updated': `${subject} edited ${entity}.`,
    'campaign.status_changed': `${subject} changed the status of ${entity}.`,
    'campaign.archived': `${subject} archived ${entity}.`,
    'campaign.deleted': `${subject} deleted ${entity}.`,
    'channel.connected': `${subject} connected ${entity}${platform ? ` on ${platform}` : ''}.`,
    'channel.reconnected': `${subject} reconnected ${entity}${platform ? ` on ${platform}` : ''}.`,
    'channel.disconnected': `${subject} disconnected ${entity}${platform ? ` on ${platform}` : ''}.`,
    'channel.connect_cancelled': `${subject} cancelled a ${platform || 'social account'} connection.`,
    'channel.connect_failed': `${subject} could not connect a ${platform || 'social account'}. ${error}`,
    'approval.requested': `${subject} requested approval for ${entity}.`,
    'approval.approved': `${subject} approved ${entity}.`,
    'approval.rejected': `${subject} rejected ${entity}.`,
    'approval.changes_requested': `${subject} requested changes to ${entity}.`,
    'approval.commented': `${subject} commented on the approval for ${entity}.`,
    'media.uploaded': `${subject} uploaded ${entity}.`,
    'workspace.created': `${subject} created ${entity}.`,
    'workspace.updated': `${subject} updated ${entity}.`,
    'workspace.logo_updated': `${subject} updated the logo for ${entity}.`,
    'workspace.ownership_transferred': `${subject} transferred ownership of ${entity}.`,
    'workspace.deleted': `${subject} deleted ${entity}.`,
    'brand.updated': `${subject} updated the brand settings for ${entity}.`,
    'brand.inferred': `${subject} generated brand settings for ${entity}.`,
    'onboarding.progressed': `${subject} continued setup for ${entity}.`,
    'onboarding.completed': `${subject} completed setup for ${entity}.`,
  };
  return mapped[action] ?? `${subject} updated ${entity}.`;
}

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function platformLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return {
    INSTAGRAM: 'Instagram',
    FACEBOOK: 'Facebook',
    LINKEDIN: 'LinkedIn',
    X: 'X',
    TIKTOK: 'TikTok',
    YOUTUBE: 'YouTube',
    MOCK: 'a demo channel',
  }[value];
}

function friendlyError(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Bridge88 recorded the failed outcome.';
  const known: Record<string, string> = {
    UNKNOWN: 'The publishing service did not provide an error reason.',
    TOKEN_EXPIRED: 'The social account needs to be reconnected.',
    NEEDS_REAUTH: 'The social account needs to be reconnected.',
    AUTH: 'The social account needs to be reconnected.',
    RATE_LIMITED: 'The social network temporarily limited publishing.',
    VALIDATION_FAILED: 'The post did not meet the social network’s publishing requirements.',
  };
  if (known[value]) return known[value];
  return 'The publishing service did not provide a user-facing error reason.';
}

export function historyTypeLabel(entityType: string): string {
  if (entityType === 'post' || entityType === 'post_platform') return 'Post';
  if (entityType === 'campaign') return 'Campaign';
  if (entityType === 'social_account' || entityType === 'oauth_attempt') return 'Account';
  if (entityType === 'approval' || entityType === 'approval_comment') return 'Approval';
  if (entityType === 'media_asset') return 'Media';
  return 'Workspace';
}
