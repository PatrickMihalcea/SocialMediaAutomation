import { Button } from '@/bridge88/components';
import { PLAN_LIMITS } from '@/lib/billing/limits';
import Link from 'next/link';

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
          return <section key={plan.key} className={`b88-card flex flex-col ${plan.key === 'PRO' ? 'border-ink' : ''}`}>
            <div className="flex items-center justify-between gap-3">
              <p className="b88-caption">{plan.name}</p>
              {plan.key === 'PRO' && <span className="b88-caption rounded-pill bg-ink px-3 py-1 text-canvas">Recommended</span>}
            </div>
            <p className="mt-4 text-[48px] font-[340]">{plan.price}<span className="text-base"> / month</span></p>
            <p className="mt-3">{plan.blurb}</p>
            <ul className="mt-6 space-y-2"><li>{limits.socialAccounts} social accounts</li><li>{limits.teamMembers} team members</li><li>{limits.scheduledPosts ?? 'Unlimited'} scheduled posts</li><li>{limits.aiGenerations.toLocaleString()} AI generations monthly</li></ul>
            <div className="mt-auto pt-8">
              <Button
                href={plan.key === 'FREE' ? '/signup' : `/signup?plan=${plan.key}`}
                variant={plan.key === 'PRO' ? 'primary' : 'secondary'}
                fullWidth
              >
                {plan.key === 'FREE' ? 'Start free' : `Choose ${plan.name}`}
              </Button>
            </div>
          </section>;
        })}
      </div>
    </main>
  );
}
