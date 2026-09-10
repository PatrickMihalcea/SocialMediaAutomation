import 'server-only';
import type { Plan } from '@prisma/client';
import { env } from '@/lib/env';
import { mockBillingProvider } from './providers/mock';
import { stripeBillingProvider } from './stripe';

export interface BillingProvider {
  readonly kind: 'mock' | 'stripe';
  checkout(input: { workspaceId: string; customerEmail: string; plan: Exclude<Plan, 'FREE'>; returnUrl: string }): Promise<string>;
  portal(input: { customerId: string; returnUrl: string }): Promise<string>;
  changePlan(input: { workspaceId: string; subscriptionId: string | null; plan: Plan }): Promise<void>;
  cancel(input: { workspaceId: string; subscriptionId: string | null; periodEnd: Date | null }): Promise<void>;
  resume(input: { workspaceId: string; subscriptionId: string | null }): Promise<void>;
}

export function billingProvider(): BillingProvider {
  return env.MOCK_MODE || !env.STRIPE_SECRET_KEY ? mockBillingProvider : stripeBillingProvider;
}
