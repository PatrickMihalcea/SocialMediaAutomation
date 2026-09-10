'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Dialog } from '@/bridge88/components';
import {
  cancelSubscriptionAction,
  changePlanAction,
  openBillingPortalAction,
  resumeSubscriptionAction,
  startCheckoutAction,
} from '@/app/actions/billing';

type Plan = 'FREE' | 'PRO' | 'BUSINESS';

export function BillingControls({
  slug,
  plan,
  canManage,
  hasSubscription,
  cancelAtPeriodEnd,
  periodEndLabel,
  isMock,
}: {
  slug: string;
  plan: Plan;
  canManage: boolean;
  hasSubscription: boolean;
  cancelAtPeriodEnd: boolean;
  periodEndLabel: string;
  isMock: boolean;
}) {
  const [intent, setIntent] = useState<Plan | 'cancel' | null>(null);

  if (!canManage) {
    return <p className="text-sm">Only the workspace owner can change billing.</p>;
  }

  const target = intent === 'PRO' || intent === 'BUSINESS' ? intent : null;
  const isStarting = !hasSubscription || plan === 'FREE';
  const action = target
    ? (isStarting ? startCheckoutAction.bind(null, slug) : changePlanAction.bind(null, slug))
    : undefined;

  return (
    <>
      <div className="flex flex-wrap gap-3">
        {plan !== 'BUSINESS' && !cancelAtPeriodEnd && (
          <Button onClick={() => setIntent('BUSINESS')}>Upgrade to Business</Button>
        )}
        {plan === 'FREE' && (
          <Button variant="secondary" onClick={() => setIntent('PRO')}>Choose Pro</Button>
        )}
        {plan === 'BUSINESS' && !cancelAtPeriodEnd && (
          <Button variant="secondary" onClick={() => setIntent('PRO')}>Downgrade to Pro</Button>
        )}
        {plan !== 'FREE' && !cancelAtPeriodEnd && (
          <Button variant="tertiary" onClick={() => setIntent('cancel')}>Cancel subscription</Button>
        )}
        {cancelAtPeriodEnd && (
          <form action={resumeSubscriptionAction.bind(null, slug)}>
            <SubmitButton label="Resume subscription" pendingLabel="Resuming…" />
          </form>
        )}
      </div>

      <Dialog
        open={Boolean(target)}
        eyebrow={isStarting ? 'Start subscription' : target === 'BUSINESS' && plan === 'PRO' ? 'Upgrade plan' : 'Change plan'}
        title={`${isStarting ? 'Choose' : 'Change to'} ${planName(target)}`}
        onClose={() => setIntent(null)}
        actions={target && action ? (
          <>
            <Button variant="secondary" onClick={() => setIntent(null)}>Keep current plan</Button>
            <form action={action}>
              <input type="hidden" name="plan" value={target} />
              <SubmitButton
                label={`${isStarting ? 'Start' : 'Confirm'} ${planName(target)}`}
                pendingLabel="Updating…"
              />
            </form>
          </>
        ) : null}
      >
        <p>
          {isStarting
            ? `${planName(target)} is ${target === 'PRO' ? '$29' : '$99'} per month.`
            : `Your limits change to ${planName(target)} immediately. A live payment provider may prorate the change.`}
          {isMock && ' This development workspace simulates the plan change and does not charge a payment method.'}
        </p>
      </Dialog>

      <Dialog
        open={intent === 'cancel'}
        eyebrow="Confirm cancellation"
        title="Cancel at the end of the billing period?"
        onClose={() => setIntent(null)}
        actions={(
          <>
            <Button variant="secondary" onClick={() => setIntent(null)}>Keep subscription</Button>
            <form action={cancelSubscriptionAction.bind(null, slug)}>
              <SubmitButton label="Schedule cancellation" pendingLabel="Scheduling…" />
            </form>
          </>
        )}
      >
        <div className="space-y-3">
          <p>Your paid access continues through {periodEndLabel}. Existing scheduled posts remain queued and connected accounts stay connected until then.</p>
          <p>After that date the workspace uses Free limits. Content and accounts above those limits remain visible, but you cannot add more until usage is back under each limit.</p>
          {isMock && <p>This development workspace records the cancellation date without contacting or charging a payment provider.</p>}
        </div>
      </Dialog>

    </>
  );
}

export function PaymentDocuments({
  slug,
  hasCustomer,
  isMock,
}: {
  slug: string;
  hasCustomer: boolean;
  isMock: boolean;
}) {
  return (
    <section className="b88-card mt-6">
      <p className="b88-caption">Payment and documents</p>
      <h2 className="b88-heading mt-2">Payment method and invoices</h2>
      {hasCustomer ? (
        <>
          <p className="mt-3">The secure billing portal manages your payment method and provider-issued invoices.</p>
          <form className="mt-5" action={openBillingPortalAction.bind(null, slug)}>
            <SubmitButton variant="secondary" label="Open billing portal" pendingLabel="Opening…" />
          </form>
        </>
      ) : (
        <p className="mt-3">
          {isMock
            ? 'Payment methods and invoices are not generated in the development billing simulator. No payment method is stored and no charge has been made.'
            : 'No billing customer is connected yet. Start a paid subscription to add a payment method and receive invoices.'}
        </p>
      )}
    </section>
  );
}

function SubmitButton({
  label,
  pendingLabel,
  variant = 'primary',
}: {
  label: string;
  pendingLabel: string;
  variant?: 'primary' | 'secondary';
}) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} disabled={pending} aria-disabled={pending}>{pending ? pendingLabel : label}</Button>;
}

function planName(plan: Plan | null): string {
  return plan === 'BUSINESS' ? 'Business' : plan === 'PRO' ? 'Pro' : 'Free';
}
