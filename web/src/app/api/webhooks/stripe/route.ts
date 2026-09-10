import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { retrieveAndSyncStripeSubscription, syncStripeSubscription, verifyStripeWebhook } from '@/lib/billing/stripe';

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });
  let event: Stripe.Event;
  try {
    event = verifyStripeWebhook(await request.text(), signature);
  } catch {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }
  if (event.type.startsWith('customer.subscription.')) {
    await syncStripeSubscription(event.data.object as Stripe.Subscription);
  } else if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (typeof session.subscription === 'string') await retrieveAndSyncStripeSubscription(session.subscription);
  }
  return NextResponse.json({ received: true });
}
