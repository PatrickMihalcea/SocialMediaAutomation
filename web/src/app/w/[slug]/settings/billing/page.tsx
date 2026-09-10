import { Badge, StatCard, StatusMessage } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { currentMonthUsage, formatBytes, nextMonthlyReset, PLAN_LIMITS } from '@/lib/billing/limits';
import { billingProvider } from '@/lib/billing/provider';
import { BillingControls, PaymentDocuments } from './billing-controls';

function sentenceCase(value: string) {
  const words = value.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ billing?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await requireWorkspace(slug, 'billing:view');
  const [subscription, socialAccounts, scheduledPosts, aiGenerations, storage] = await Promise.all([
    db.subscription.findUnique({ where: { workspaceId: ctx.workspace.id } }),
    db.socialAccount.count({ where: { workspaceId: ctx.workspace.id, status: { not: 'DISCONNECTED' } } }),
    db.post.count({ where: { workspaceId: ctx.workspace.id, status: 'SCHEDULED' } }),
    currentMonthUsage(ctx.workspace.id, 'ai_generations'),
    db.mediaAsset.aggregate({ where: { workspaceId: ctx.workspace.id }, _sum: { size: true } }),
  ]);
  const paidPlan = subscription?.plan ?? 'FREE';
  const effectivePlan = subscription && ['ACTIVE', 'TRIALING'].includes(subscription.status) ? paidPlan : 'FREE';
  const limits = PLAN_LIMITS[effectivePlan];
  const storageBytes = storage._sum.size ?? 0;
  const resetDate = nextMonthlyReset();
  const resetLabel = resetDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const periodEndLabel = (subscription?.currentPeriodEnd ?? resetDate).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const feedback = billingFeedback(query.billing);
  const statusNotice = subscriptionNotice(subscription?.status, subscription?.cancelAtPeriodEnd ?? false, periodEndLabel);

  return (
    <>
      <p className="b88-eyebrow">Workspace billing</p>
      <h1 className="b88-page-title mt-3">Plan and usage</h1>
      {feedback && <StatusMessage className="mt-5" tone={feedback.tone}>{feedback.message}</StatusMessage>}
      {statusNotice && <StatusMessage className="mt-5" tone={statusNotice.tone}>{statusNotice.message}</StatusMessage>}
      <section className="b88-card mt-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge tone="ink">{sentenceCase(paidPlan)}</Badge>
            <h2 className="b88-heading mt-4">Current plan</h2>
            <p className="mt-2">Status: {sentenceCase(subscription?.status ?? 'ACTIVE')}</p>
            {effectivePlan !== paidPlan && <p className="mt-2 text-sm">Free limits apply until the subscription is active again.</p>}
          </div>
          <div className="text-right text-sm">
            <p>{subscription?.cancelAtPeriodEnd ? `Access changes ${periodEndLabel}` : subscription?.currentPeriodEnd ? `Renews ${periodEndLabel}` : 'No payment renewal is scheduled'}</p>
            <p className="mt-1">{billingProvider().kind === 'mock' ? 'Development billing simulator' : 'Secure provider billing'}</p>
          </div>
        </div>
        <p className="mt-5 text-sm">
          {socialAccounts} of {limits.socialAccounts} accounts · {scheduledPosts} of {limits.scheduledPosts?.toLocaleString() ?? 'unlimited'} scheduled posts · {aiGenerations.toLocaleString()} of {limits.aiGenerations.toLocaleString()} AI generations · {formatBytes(storageBytes)} of {formatBytes(limits.storageBytes)} storage
        </p>
        <div className="mt-5">
          <BillingControls
            slug={slug}
            plan={effectivePlan}
            canManage={ctx.can('billing:manage')}
            hasSubscription={Boolean(subscription)}
            cancelAtPeriodEnd={subscription?.cancelAtPeriodEnd ?? false}
            periodEndLabel={periodEndLabel}
            isMock={billingProvider().kind === 'mock'}
          />
        </div>
      </section>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-4">
        <StatCard label="Social accounts" value={`${socialAccounts} / ${limits.socialAccounts}`} />
        <StatCard
          label={`Scheduled posts${limits.scheduledPosts === null ? ' · Unlimited' : ''}`}
          value={limits.scheduledPosts === null ? `${scheduledPosts} used` : `${scheduledPosts} / ${limits.scheduledPosts.toLocaleString()}`}
        />
        <StatCard label="AI generations" value={`${aiGenerations.toLocaleString()} / ${limits.aiGenerations.toLocaleString()}`} />
        <StatCard label="Media storage" value={`${formatBytes(storageBytes)} / ${formatBytes(limits.storageBytes)}`} />
      </div>
      <p className="mt-4 text-sm">AI generation usage resets on {resetLabel}. Account and storage capacity do not reset automatically. Scheduled capacity returns when posts publish or are canceled.</p>

      <PaymentDocuments
        slug={slug}
        hasCustomer={Boolean(subscription?.stripeCustomerId)}
        isMock={billingProvider().kind === 'mock'}
      />
    </>
  );
}

function subscriptionNotice(status: string | undefined, cancelAtPeriodEnd: boolean, periodEnd: string) {
  if (cancelAtPeriodEnd) return { tone: 'neutral' as const, message: `Cancellation is scheduled for ${periodEnd}. Resume before then to keep paid access.` };
  if (status === 'PAST_DUE') return { tone: 'error' as const, message: 'Payment is past due. Free limits are active. Open the billing portal to update the payment method and retry payment.' };
  if (status === 'UNPAID') return { tone: 'error' as const, message: 'The subscription is unpaid. Free limits are active. Update the payment method in the billing portal or choose a new plan.' };
  if (status === 'INCOMPLETE') return { tone: 'error' as const, message: 'The subscription did not finish. No paid access is active. Return to checkout or choose another plan.' };
  if (status === 'CANCELED') return { tone: 'neutral' as const, message: 'This subscription has ended. Free limits are active. Choose Pro or Business to start a new subscription.' };
  return null;
}

function billingFeedback(value: string | undefined) {
  return {
    updated: { tone: 'success' as const, message: 'The simulated subscription is active. No payment method was charged.' },
    'plan-changed': { tone: 'success' as const, message: 'The plan and workspace limits were updated.' },
    'cancellation-scheduled': { tone: 'success' as const, message: 'Cancellation is scheduled for the end of the current period.' },
    resumed: { tone: 'success' as const, message: 'The subscription will continue beyond the current period.' },
    cancelled: { tone: 'neutral' as const, message: 'Checkout was canceled. The workspace plan did not change.' },
    'no-customer': { tone: 'error' as const, message: 'No billing customer is connected. Start a paid subscription first.' },
    'mock-portal': { tone: 'neutral' as const, message: 'The development simulator has no payment portal, invoices or stored payment method.' },
  }[value ?? ''] ?? null;
}
