import 'server-only';
import { Plan } from '@prisma/client';
import { db } from '@/lib/db';
import { limitReached } from '@/lib/errors';

export const PLAN_LIMITS = {
  FREE: { socialAccounts: 3, scheduledPosts: 10, aiGenerations: 100, teamMembers: 1 },
  PRO: { socialAccounts: 10, scheduledPosts: null, aiGenerations: 1_000, teamMembers: 5 },
  BUSINESS: { socialAccounts: 30, scheduledPosts: null, aiGenerations: 5_000, teamMembers: 50 },
} as const satisfies Record<
  Plan,
  {
    socialAccounts: number;
    scheduledPosts: number | null;
    aiGenerations: number;
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
    throw limitReached(
      `${plan === Plan.FREE ? 'The Free plan' : `Your ${plan.toLowerCase()} plan`} allows ${limit.toLocaleString()} ${label(feature)}. Change plans to add more.`,
    );
  }
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
    teamMembers: 'workspace members',
  }[feature];
}
