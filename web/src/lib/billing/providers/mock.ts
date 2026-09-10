import 'server-only';
import type { BillingProvider } from '../provider';
import { db } from '@/lib/db';

export const mockBillingProvider: BillingProvider = {
  kind: 'mock',
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
  async changePlan({ workspaceId, plan }) {
    await db.subscription.upsert({
      where: { workspaceId },
      create: { workspaceId, plan, status: 'ACTIVE' },
      update: { plan, status: 'ACTIVE', canceledAt: null, cancelAtPeriodEnd: false },
    });
  },
  async cancel({ workspaceId, periodEnd }) {
    const fallbackEnd = new Date();
    fallbackEnd.setUTCMonth(fallbackEnd.getUTCMonth() + 1);
    await db.subscription.update({
      where: { workspaceId },
      data: { cancelAtPeriodEnd: true, canceledAt: new Date(), currentPeriodEnd: periodEnd ?? fallbackEnd },
    });
  },
  async resume({ workspaceId }) {
    await db.subscription.update({
      where: { workspaceId },
      data: { cancelAtPeriodEnd: false, canceledAt: null, status: 'ACTIVE' },
    });
  },
};
