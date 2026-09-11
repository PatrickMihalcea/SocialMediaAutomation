import type { Platform, PostStatus } from '@prisma/client';

const TYPES = new Set(['post', 'media', 'campaign', 'account']);
const STATUSES = new Set<PostStatus>(['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED']);
const PLATFORMS = new Set<Platform>(['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'X', 'TIKTOK', 'YOUTUBE', 'MOCK']);
const SORTS = new Set(['newest', 'oldest', 'title']);

export interface SearchFilters {
  q: string;
  type?: string;
  status?: PostStatus;
  platform?: Platform;
  account?: string;
  campaign?: string;
  author?: string;
  from?: Date;
  to?: Date;
  sort: 'newest' | 'oldest' | 'title';
  error?: string;
}

export function parseSearchFilters(input: Record<string, string | undefined>): SearchFilters {
  const from = parseDate(input.from);
  const to = parseDate(input.to, true);
  const filters: SearchFilters = {
    q: input.q?.trim() ?? '',
    type: input.type && TYPES.has(input.type) ? input.type : undefined,
    status: input.status && STATUSES.has(input.status as PostStatus) ? input.status as PostStatus : undefined,
    platform: input.platform && PLATFORMS.has(input.platform as Platform) ? input.platform as Platform : undefined,
    account: input.account || undefined,
    campaign: input.campaign || undefined,
    author: input.author || undefined,
    from: from ?? undefined,
    to: to ?? undefined,
    sort: input.sort && SORTS.has(input.sort) ? input.sort as SearchFilters['sort'] : 'newest',
  };
  if ((input.from && !from) || (input.to && !to)) filters.error = 'Enter a valid date.';
  else if (from && to && from > to) filters.error = 'The start date must be before the end date.';
  return filters;
}

export function hasSearchCriteria(filters: SearchFilters) {
  return Boolean(filters.q || filters.type || filters.status || filters.platform || filters.account || filters.campaign || filters.author || filters.from || filters.to);
}

function parseDate(value?: string, end = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
