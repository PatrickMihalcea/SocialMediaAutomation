import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forbidden } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  requireWorkspace: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  findUnique: vi.fn(),
  checkout: vi.fn(),
  portal: vi.fn(),
  changePlan: vi.fn(),
  cancel: vi.fn(),
  resume: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireWorkspace: mocks.requireWorkspace }));
vi.mock('@/lib/db', () => ({ db: { subscription: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/env', () => ({ publicEnv: { appUrl: 'http://localhost:3000' } }));
vi.mock('@/lib/billing/provider', () => ({
  billingProvider: () => ({
    kind: 'mock',
    checkout: mocks.checkout,
    portal: mocks.portal,
    changePlan: mocks.changePlan,
    cancel: mocks.cancel,
    resume: mocks.resume,
  }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import {
  cancelSubscriptionAction,
  changePlanAction,
  openBillingPortalAction,
  resumeSubscriptionAction,
  startCheckoutAction,
} from '@/app/actions/billing';

describe('billing action authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['VIEWER', 'start checkout', () => startCheckoutAction('northwind-studio', planForm('PRO'))],
    ['VIEWER', 'change plan', () => changePlanAction('northwind-studio', planForm('BUSINESS'))],
    ['VIEWER', 'cancel', () => cancelSubscriptionAction('northwind-studio')],
    ['VIEWER', 'resume', () => resumeSubscriptionAction('northwind-studio')],
    ['VIEWER', 'open portal', () => openBillingPortalAction('northwind-studio')],
    ['EDITOR', 'start checkout', () => startCheckoutAction('northwind-studio', planForm('PRO'))],
    ['EDITOR', 'change plan', () => changePlanAction('northwind-studio', planForm('BUSINESS'))],
    ['EDITOR', 'cancel', () => cancelSubscriptionAction('northwind-studio')],
    ['EDITOR', 'resume', () => resumeSubscriptionAction('northwind-studio')],
    ['EDITOR', 'open portal', () => openBillingPortalAction('northwind-studio')],
  ])('rejects %s directly calling %s', async (role, _name, invoke) => {
    mocks.requireWorkspace.mockRejectedValue(forbidden(`Your role (${role.toLowerCase()}) cannot manage billing.`));
    await expect(invoke()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.requireWorkspace).toHaveBeenCalledWith('northwind-studio', 'billing:manage');
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.changePlan).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
  });
});

function planForm(plan: string): FormData {
  const form = new FormData();
  form.set('plan', plan);
  return form;
}
