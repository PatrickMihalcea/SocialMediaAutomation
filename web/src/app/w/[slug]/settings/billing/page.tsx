import { Badge, Button, StatCard } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { PLAN_LIMITS } from '@/lib/billing/limits';
import { openBillingPortalAction, startCheckoutAction } from '@/app/actions/billing';

function sentenceCase(value: string) {
  const words = value.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default async function BillingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'billing:view');
  const subscription = await db.subscription.findUnique({ where: { workspaceId: ctx.workspace.id } });
  const plan = subscription?.plan ?? 'FREE';
  const limits = PLAN_LIMITS[plan];
  return (
    <>
      <p className="b88-eyebrow">Workspace billing</p><h1 className="b88-page-title mt-3">Plan and usage</h1>
      <section className="b88-card mt-8">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><Badge tone="ink">{sentenceCase(plan)}</Badge><h2 className="b88-heading mt-4">Current plan</h2><p className="mt-2">Status: {sentenceCase(subscription?.status ?? 'ACTIVE')}</p></div>
        {ctx.can('billing:manage') && subscription?.stripeCustomerId && <form action={openBillingPortalAction.bind(null, slug)}><Button type="submit" variant="secondary">Manage billing</Button></form>}</div>
      </section>
      <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Social accounts" value={String(limits.socialAccounts)} /><StatCard label="Team members" value={String(limits.teamMembers)} />
        <StatCard label="Scheduled posts" value={limits.scheduledPosts?.toString() ?? 'Unlimited'} /><StatCard label="AI generations" value={limits.aiGenerations.toLocaleString()} />
      </div>
      {ctx.can('billing:manage') && <section className="mt-6 rounded-lg bg-[var(--block-cream)] p-6"><p className="b88-caption">Change plan</p><h2 className="b88-heading mt-2">Add workspace capacity</h2>
        <div className="mt-5 flex flex-wrap gap-3"><form action={startCheckoutAction.bind(null, slug)}><input type="hidden" name="plan" value="PRO"/><Button type="submit">Choose Pro</Button></form><form action={startCheckoutAction.bind(null, slug)}><input type="hidden" name="plan" value="BUSINESS"/><Button type="submit" variant="secondary">Choose Business</Button></form></div>
      </section>}
    </>
  );
}
