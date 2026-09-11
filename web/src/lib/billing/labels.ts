import type { Plan, SubscriptionStatus } from '@prisma/client';

/**
 * Billing enums are provider vocabulary, not English. Every surface that shows
 * a plan or subscription state reads these maps; nothing de-underscores a token
 * at the render site.
 */

export const PLAN_LABELS: Record<Plan, string> = {
  FREE: 'Free',
  PRO: 'Pro',
  BUSINESS: 'Business',
};

/**
 * Wording tracks the provider's meaning rather than the token: PAST_DUE is a
 * payment the provider is still retrying, UNPAID is one it has given up on, and
 * INCOMPLETE never finished checkout at all.
 */
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  ACTIVE: 'Active',
  TRIALING: 'Free trial',
  PAST_DUE: 'Payment overdue',
  CANCELED: 'Ended',
  INCOMPLETE: 'Setup incomplete',
  UNPAID: 'Payment failed',
};

export function planLabel(plan: Plan | null | undefined): string {
  return PLAN_LABELS[plan ?? 'FREE'];
}

export function subscriptionStatusLabel(status: SubscriptionStatus | null | undefined): string {
  return SUBSCRIPTION_STATUS_LABELS[status ?? 'ACTIVE'];
}
