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

export type LimitMessageAudience = 'refusal' | 'destination';

export const GENERIC_LIMIT_ARRIVAL =
  'This workspace has reached a plan limit. Disconnect unused capacity or choose a higher plan.';

export function limitMessage(input: {
  plan: Plan;
  feature: LimitedFeature;
  used: number;
  limit: number;
  now?: Date;
  audience?: LimitMessageAudience;
}): string {
  const planLabel = input.plan === Plan.FREE ? 'Free' : sentenceCase(input.plan);
  const amount = input.feature === 'storageBytes'
    ? `${formatBytes(input.used)} of ${formatBytes(input.limit)}`
    : `${input.used.toLocaleString()} of ${input.limit.toLocaleString()}`;
  const reset = resetExplanation(input.feature, input.now);
  const audience = input.audience ?? 'refusal';
  return `You are using ${amount} ${label(input.feature)} on the ${planLabel} plan. ${reset} ${nextStep(input.feature, audience)}`;
}

/**
 * Query-param `reason` is attacker-controlled. Only a message we ourselves
 * generate is shown; anything else becomes a generic arrival notice.
 */
export function arrivalLimitNotice(billing: unknown, reason: unknown): string | null {
  try {
    const text = firstQueryValue(reason);
    if (text) {
      const destination = destinationLimitMessage(text);
      return destination ?? GENERIC_LIMIT_ARRIVAL;
    }
    return firstQueryValue(billing) === 'limit-reached' ? GENERIC_LIMIT_ARRIVAL : null;
  } catch {
    return GENERIC_LIMIT_ARRIVAL;
  }
}

export function destinationLimitMessage(message: string): string | null {
  if (typeof message !== 'string' || message.length < 40 || message.length > 400) return null;
  if (/[<>]/.test(message) || /[\r\n]/.test(message)) return null;

  for (const feature of FEATURE_ORDER) {
    const refusal = nextStep(feature, 'refusal');
    const destination = nextStep(feature, 'destination');
    if (!knownLimitBody(message, feature)) continue;
    if (message.endsWith(refusal)) return `${message.slice(0, -refusal.length)}${destination}`;
    if (message.endsWith(destination)) return message;
  }
  return null;
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

const FEATURE_ORDER: LimitedFeature[] = [
  'socialAccounts',
  'scheduledPosts',
  'aiGenerations',
  'storageBytes',
  'teamMembers',
];

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

function nextStep(feature: LimitedFeature, audience: LimitMessageAudience): string {
  const alternative = {
    socialAccounts: 'Disconnect an account',
    scheduledPosts: 'Cancel a scheduled post',
    aiGenerations: 'Wait for the reset',
    storageBytes: 'Delete media',
    teamMembers: 'Remove a workspace member',
  }[feature];
  return audience === 'destination'
    ? `${alternative} or choose a higher plan.`
    : `${alternative} or change plans in Billing.`;
}

function knownLimitBody(message: string, feature: LimitedFeature): boolean {
  const amount = feature === 'storageBytes'
    ? String.raw`\d{1,6}(?:\.\d)? (?:bytes|KB|MB|GB) of \d{1,6}(?:\.\d)? (?:bytes|KB|MB|GB)`
    : String.raw`\d{1,9}(?:,\d{3})* of \d{1,9}(?:,\d{3})*`;
  const reset = feature === 'aiGenerations'
    ? String.raw`This usage resets on (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\.`
    : feature === 'scheduledPosts'
      ? String.raw`This capacity has no fixed reset date; it becomes available when scheduled posts publish or are canceled\.`
      : String.raw`This capacity does not reset automatically\.`;
  return new RegExp(
    `^You are using ${amount} ${label(feature)} on the (?:Free|Pro|Business) plan\\. ${reset} `,
  ).test(message);
}

/** A repeated query parameter arrives as an array; every reader takes the first value. */
export function firstQueryValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    const trimmed = value[0].trim();
    return trimmed ? trimmed : null;
  }
  return null;
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
