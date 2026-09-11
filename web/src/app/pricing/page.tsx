import { Button, PricingCard } from '@/bridge88/components';
import { formatBytes, PLAN_LIMITS } from '@/lib/billing/limits';
import Link from 'next/link';

export const metadata = { title: 'Pricing' };

const plans = [
  { key: 'FREE', name: 'Free', price: '$0', blurb: 'For a single operator starting a publishing queue.' },
  { key: 'PRO', name: 'Pro', price: '$29', blurb: 'For teams running several channels every week.' },
  { key: 'BUSINESS', name: 'Business', price: '$99', blurb: 'For larger teams with higher automation volume.' },
] as const;

export default function PricingPage() {
  return (
    <main id="main-content" className="marketing-shell py-12">
      <Link href="/" className="text-xl font-[540]">Bridge88</Link>
      <p className="b88-eyebrow mt-12">Plans</p><h1 className="b88-page-title mt-3">Choose the capacity you need</h1>
      <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const limits = PLAN_LIMITS[plan.key];
          return <PricingCard
            key={plan.key}
            tier={plan.key === 'PRO' ? `${plan.name} · Recommended` : plan.name}
            price={plan.price}
            cadence="/ month"
            blurb={plan.blurb}
            highlighted={plan.key === 'PRO'}
            features={[
              `${limits.socialAccounts} social accounts`,
              `${limits.teamMembers} ${limits.teamMembers === 1 ? 'team member' : 'team members'}`,
              `${limits.scheduledPosts ?? 'Unlimited'} scheduled posts`,
              `${limits.aiGenerations.toLocaleString()} AI generations monthly`,
              `${formatBytes(limits.storageBytes)} media storage`,
            ]}
            cta={<Button
                href={plan.key === 'FREE' ? '/signup' : `/signup?plan=${plan.key}`}
                variant={plan.key === 'PRO' ? 'primary' : 'secondary'}
                fullWidth
              >
                {plan.key === 'FREE' ? 'Start free' : `Choose ${plan.name}`}
              </Button>}
          />;
        })}
      </div>
      <p className="mt-8 max-w-2xl text-sm">Paid plans are billed monthly. You can change or cancel a plan from workspace billing; access continues through the paid period.</p>
    </main>
  );
}
