import type { ApprovalDecision, PostPlatformStatus, PostStatus } from '@prisma/client';

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  DRAFT: 'Draft',
  REJECTED: 'Rejected',
  PENDING_APPROVAL: 'In review',
  APPROVED: 'Approved',
  SCHEDULED: 'Scheduled',
  PUBLISHING: 'Publishing',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const POST_PLATFORM_STATUS_LABELS: Record<PostPlatformStatus, string> = {
  PENDING: 'Waiting',
  PUBLISHING: 'Publishing',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
  CANCELLED: 'Cancelled',
};

export const APPROVAL_DECISION_LABELS: Record<ApprovalDecision, string> = {
  COMMENT: 'Comment',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CHANGES_REQUESTED: 'Changes requested',
};
