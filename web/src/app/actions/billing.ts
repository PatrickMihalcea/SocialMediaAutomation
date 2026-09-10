'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/guard';
import { billingProvider } from '@/lib/billing/provider';
import { db } from '@/lib/db';
import { publicEnv } from '@/lib/env';

export async function startCheckoutAction(slug: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'billing:manage');
  const plan = z.enum(['PRO', 'BUSINESS']).parse(formData.get('plan'));
  const returnUrl = `${publicEnv.appUrl}/w/${slug}/settings/billing`;
  redirect(await billingProvider().checkout({
    workspaceId: ctx.workspace.id,
    customerEmail: ctx.user.email,
    plan,
    returnUrl,
  }));
}

export async function openBillingPortalAction(slug: string) {
  const ctx = await requireWorkspace(slug, 'billing:manage');
  const subscription = await db.subscription.findUnique({ where: { workspaceId: ctx.workspace.id } });
  if (!subscription?.stripeCustomerId) redirect(`/w/${slug}/settings/billing?billing=no-customer`);
  redirect(await billingProvider().portal({
    customerId: subscription.stripeCustomerId,
    returnUrl: `${publicEnv.appUrl}/w/${slug}/settings/billing`,
  }));
}

export async function changePlanAction(slug: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'billing:manage');
  const plan = z.enum(['PRO', 'BUSINESS']).parse(formData.get('plan'));
  const subscription = await db.subscription.findUnique({ where: { workspaceId: ctx.workspace.id } });
  if (!subscription) redirect(`/w/${slug}/settings/billing?billing=no-subscription`);
  await billingProvider().changePlan({
    workspaceId: ctx.workspace.id,
    subscriptionId: subscription.stripeSubscriptionId,
    plan,
  });
  revalidatePath(`/w/${slug}/settings/billing`);
  redirect(`/w/${slug}/settings/billing?billing=plan-changed`);
}

export async function cancelSubscriptionAction(slug: string) {
  const ctx = await requireWorkspace(slug, 'billing:manage');
  const subscription = await db.subscription.findUnique({ where: { workspaceId: ctx.workspace.id } });
  if (!subscription) redirect(`/w/${slug}/settings/billing?billing=no-subscription`);
  await billingProvider().cancel({
    workspaceId: ctx.workspace.id,
    subscriptionId: subscription.stripeSubscriptionId,
    periodEnd: subscription.currentPeriodEnd,
  });
  revalidatePath(`/w/${slug}/settings/billing`);
  redirect(`/w/${slug}/settings/billing?billing=cancellation-scheduled`);
}

export async function resumeSubscriptionAction(slug: string) {
  const ctx = await requireWorkspace(slug, 'billing:manage');
  const subscription = await db.subscription.findUnique({ where: { workspaceId: ctx.workspace.id } });
  if (!subscription) redirect(`/w/${slug}/settings/billing?billing=no-subscription`);
  await billingProvider().resume({
    workspaceId: ctx.workspace.id,
    subscriptionId: subscription.stripeSubscriptionId,
  });
  revalidatePath(`/w/${slug}/settings/billing`);
  redirect(`/w/${slug}/settings/billing?billing=resumed`);
}
