import 'server-only';
import Stripe from 'stripe';
import type { Plan, SubscriptionStatus } from '@prisma/client';
import type { BillingProvider } from './provider';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

const client = () => new Stripe(env.STRIPE_SECRET_KEY);

const priceFor = (plan: Exclude<Plan, 'FREE'>) =>
  plan === 'PRO' ? env.STRIPE_PRICE_PRO : env.STRIPE_PRICE_BUSINESS;

export const stripeBillingProvider: BillingProvider = {
  async checkout({ workspaceId, customerEmail, plan, returnUrl }) {
    const price = priceFor(plan);
    if (!price) throw new Error(`Stripe price for ${plan.toLowerCase()} is not configured.`);
    const existing = await db.subscription.findUnique({ where: { workspaceId } });
    const session = await client().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: `${returnUrl}?billing=success`,
      cancel_url: `${returnUrl}?billing=cancelled`,
      customer: existing?.stripeCustomerId ?? undefined,
      customer_email: existing?.stripeCustomerId ? undefined : customerEmail,
      client_reference_id: workspaceId,
      subscription_data: { metadata: { workspaceId, plan } },
      metadata: { workspaceId, plan },
    });
    if (!session.url) throw new Error('Stripe did not return a checkout URL.');
    return session.url;
  },
  async portal({ customerId, returnUrl }) {
    const session = await client().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return session.url;
  },
};

export function verifyStripeWebhook(payload: string, signature: string): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('Stripe webhook secret is not configured.');
  return client().webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
}

export async function syncStripeSubscription(subscription: Stripe.Subscription): Promise<void> {
  const workspaceId = subscription.metadata.workspaceId;
  if (!workspaceId) throw new Error('Stripe subscription is missing workspaceId metadata.');
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const plan: Plan = priceId === env.STRIPE_PRICE_BUSINESS ? 'BUSINESS' : priceId === env.STRIPE_PRICE_PRO ? 'PRO' : 'FREE';
  const statusMap: Record<string, SubscriptionStatus> = {
    active: 'ACTIVE', trialing: 'TRIALING', past_due: 'PAST_DUE', canceled: 'CANCELED',
    incomplete: 'INCOMPLETE', incomplete_expired: 'INCOMPLETE', unpaid: 'UNPAID', paused: 'PAST_DUE',
  };
  await db.subscription.upsert({
    where: { workspaceId },
    create: {
      workspaceId, plan, status: statusMap[subscription.status] ?? 'INCOMPLETE',
      stripeCustomerId: String(subscription.customer), stripeSubscriptionId: subscription.id,
      stripePriceId: priceId, currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    },
    update: {
      plan, status: statusMap[subscription.status] ?? 'INCOMPLETE',
      stripeCustomerId: String(subscription.customer), stripeSubscriptionId: subscription.id,
      stripePriceId: priceId, currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    },
  });
}

export async function retrieveAndSyncStripeSubscription(subscriptionId: string): Promise<void> {
  await syncStripeSubscription(await client().subscriptions.retrieve(subscriptionId));
}
