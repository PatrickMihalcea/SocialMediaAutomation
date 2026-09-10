'use server';

import { redirect } from 'next/navigation';
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
