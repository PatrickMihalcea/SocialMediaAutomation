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

/**
 * What a post's status means to the person looking at it.
 *
 * "Publish now" does not publish inline — it sets SCHEDULED with a time of now
 * and hands the post to the publishing engine, which is what gives it retries,
 * per-channel state and a failed-jobs view. Correct internally, and a lie on
 * screen: someone who pressed "publish now" and reads "Scheduled" concludes it
 * did not work. A scheduled time that has arrived is a post on its way out.
 */
export function postStatusLabel(status: PostStatus, scheduledAt?: Date | string | null): string {
  if (status === 'SCHEDULED' && scheduledAt) {
    const at = typeof scheduledAt === 'string' ? new Date(scheduledAt) : scheduledAt;
    if (at.getTime() <= Date.now()) return 'Posting now';
  }
  return POST_STATUS_LABELS[status];
}

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
