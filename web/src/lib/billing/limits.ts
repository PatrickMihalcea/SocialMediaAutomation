import 'server-only';
import { Plan } from '@prisma/client';
import { db } from '@/lib/db';
import { limitReached } from '@/lib/errors';

export const PLAN_LIMITS = {
  FREE: { socialAccounts: 3, scheduledPosts: 10, aiGenerations: 100, storageBytes: 1024 ** 3, teamMembers: 1 },
  PRO: { socialAccounts: 10, scheduledPosts: null, aiGenerations: 1_000, storageBytes: 10 * 1024 ** 3, teamMembers: 5 },
  BUSINESS: { socialAccounts: 30, scheduledPosts: null, aiGenerations: 5_000, storageBytes: 100 * 1024 ** 3, teamMembers: 50 },
} as const satisfies Record<
  Plan,
  {
    socialAccounts: number;
    scheduledPosts: number | null;
    aiGenerations: number;
    storageBytes: number;
    teamMembers: number;
  }
>;

export type LimitedFeature = keyof (typeof PLAN_LIMITS)[Plan];

export async function workspacePlan(workspaceId: string): Promise<Plan> {
  const subscription = await db.subscription.findUnique({
    where: { workspaceId },
    select: { plan: true, status: true },
  });
  return subscription?.status === 'ACTIVE' || subscription?.status === 'TRIALING'
    ? subscription.plan
    : Plan.FREE;
}

export async function assertWithinLimit(
  workspaceId: string,
  feature: LimitedFeature,
  currentValue: number,
): Promise<void> {
  const plan = await workspacePlan(workspaceId);
  const limit = PLAN_LIMITS[plan][feature];
  if (limit !== null && currentValue >= limit) {
    throw limitReached(limitMessage({ plan, feature, used: currentValue, limit }));
  }
}

export function nextMonthlyReset(from = new Date()): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
}

export function limitMessage(input: {
  plan: Plan;
  feature: LimitedFeature;
  used: number;
  limit: number;
  now?: Date;
}): string {
  const planLabel = input.plan === Plan.FREE ? 'Free' : sentenceCase(input.plan);
  const amount = input.feature === 'storageBytes'
    ? `${formatBytes(input.used)} of ${formatBytes(input.limit)}`
    : `${input.used.toLocaleString()} of ${input.limit.toLocaleString()}`;
  const reset = resetExplanation(input.feature, input.now);
  return `You are using ${amount} ${label(input.feature)} on the ${planLabel} plan. ${reset} ${nextStep(input.feature)}`;
}

export async function currentMonthUsage(workspaceId: string, metric: string): Promise<number> {
  const period = new Date();
  period.setUTCDate(1);
  period.setUTCHours(0, 0, 0, 0);
  const record = await db.usageRecord.findUnique({
    where: { workspaceId_metric_period: { workspaceId, metric, period } },
  });
  return record?.value ?? 0;
}

export async function incrementUsage(
  workspaceId: string,
  metric: string,
  amount = 1,
): Promise<number> {
  const period = new Date();
  period.setUTCDate(1);
  period.setUTCHours(0, 0, 0, 0);
  const record = await db.usageRecord.upsert({
    where: { workspaceId_metric_period: { workspaceId, metric, period } },
    create: { workspaceId, metric, period, value: amount },
    update: { value: { increment: amount } },
  });
  return record.value;
}

function label(feature: LimitedFeature): string {
  return {
    socialAccounts: 'connected social accounts',
    scheduledPosts: 'scheduled posts',
    aiGenerations: 'AI generations per month',
    storageBytes: 'of media storage',
    teamMembers: 'workspace members',
  }[feature];
}

function resetExplanation(feature: LimitedFeature, now = new Date()): string {
  if (feature === 'aiGenerations') {
    return `This usage resets on ${nextMonthlyReset(now).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })}.`;
  }
  if (feature === 'scheduledPosts') {
    return 'This capacity has no fixed reset date; it becomes available when scheduled posts publish or are canceled.';
  }
  return 'This capacity does not reset automatically.';
}

function nextStep(feature: LimitedFeature): string {
  const alternative = {
    socialAccounts: 'Disconnect an account',
    scheduledPosts: 'Cancel a scheduled post',
    aiGenerations: 'Wait for the reset',
    storageBytes: 'Delete media',
    teamMembers: 'Remove a workspace member',
  }[feature];
  return `${alternative} or change plans in Billing.`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${trim(bytes / 1024 ** 3)} GB`;
  if (bytes >= 1024 ** 2) return `${trim(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${trim(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

function trim(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function sentenceCase(value: string): string {
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
