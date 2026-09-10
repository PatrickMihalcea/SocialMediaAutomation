import 'server-only';
import type { BillingProvider } from '../provider';
import { db } from '@/lib/db';

export const mockBillingProvider: BillingProvider = {
  async checkout({ workspaceId, plan, returnUrl }) {
    await db.subscription.upsert({
      where: { workspaceId },
      create: { workspaceId, plan, status: 'ACTIVE' },
      update: { plan, status: 'ACTIVE', canceledAt: null, cancelAtPeriodEnd: false },
    });
    return `${returnUrl}?billing=updated`;
  },
  async portal({ returnUrl }) {
    return `${returnUrl}?billing=mock-portal`;
  },
};
