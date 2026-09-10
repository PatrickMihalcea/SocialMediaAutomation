import 'server-only';
import type { Plan } from '@prisma/client';
import { env } from '@/lib/env';
import { mockBillingProvider } from './providers/mock';
import { stripeBillingProvider } from './stripe';

export interface BillingProvider {
  checkout(input: { workspaceId: string; customerEmail: string; plan: Exclude<Plan, 'FREE'>; returnUrl: string }): Promise<string>;
  portal(input: { customerId: string; returnUrl: string }): Promise<string>;
}

export function billingProvider(): BillingProvider {
  return env.MOCK_MODE || !env.STRIPE_SECRET_KEY ? mockBillingProvider : stripeBillingProvider;
}
