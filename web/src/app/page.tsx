import { CalendarDays, Check, Layers3, Send, Sparkles } from 'lucide-react';
import { Badge, Button } from '@/bridge88/components';

export const metadata = { title: 'Social publishing' };

export default function MarketingPage() {
  return (
    <main id="main-content" className="marketing-shell" tabIndex={-1}>
      <nav className="marketing-nav">
        <span className="text-xl font-[540]">Bridge88</span>
        <div className="flex flex-wrap items-center gap-2">
          <Button href="/pricing" variant="tertiary">Pricing</Button>
          <Button href="/login" variant="tertiary">Sign in</Button>
          <Button href="/signup">Start free</Button>
        </div>
      </nav>

      <section className="hero-block">
        <div>
          <p className="b88-eyebrow">Social publishing</p>
          <h1 className="b88-display mt-6">Write it once.<br />Publish it everywhere.</h1>
          <p className="mt-6 max-w-xl text-xl">
            One queue for your channels, reviewers and media. Bridge88 validates every version before it reaches the publishing worker.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button href="/signup" className="w-full sm:w-auto">Create a workspace</Button>
            <Button href="#how-it-works" variant="secondary" className="w-full sm:w-auto">See how it works</Button>
          </div>
        </div>
        <div className="product-mock">
          <div className="flex items-center justify-between">
            <span className="b88-caption">This week’s queue</span>
            <Badge tone="lime">6 scheduled</Badge>
          </div>
          {[
            ['Tue · 09:00', 'Product lessons from the last release', 'LinkedIn'],
            ['Wed · 12:00', 'A shorter build update', 'X'],
            ['Thu · 17:00', 'Studio walkthrough', 'Instagram'],
          ].map(([time, title, channel]) => (
            <div key={title} className="mt-4 flex items-center gap-4 rounded-md bg-surface-soft p-4">
              <span className="flex size-11 items-center justify-center rounded-md bg-[var(--block-cream)]"><CalendarDays size={18}/></span>
              <div className="min-w-0 flex-1">
                <p className="b88-caption">{time} · {channel}</p>
                <p className="mt-1 truncate font-[480]">{title}</p>
              </div>
              <Check size={18} color="var(--success)" />
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="mb-24">
        <p className="b88-eyebrow">How it works</p>
        <h2 className="b88-page-title mt-3 max-w-2xl">One publishing system. Separate channel voices.</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            [Layers3, 'Compose', 'Build one logical post with a separate, validated version for every network.'],
            [Sparkles, 'Adapt', 'Use AI when it helps. Brand voice is applied automatically, but the scheduler works without it.'],
            [Send, 'Publish', 'Workers refresh tokens, retry transient errors and record exactly why a permanent failure stopped.'],
          ].map(([Icon, title, body]) => {
            const FeatureIcon = Icon as typeof Layers3;
            return (
              <article key={String(title)} className="b88-card">
                <FeatureIcon size={24} strokeWidth={1.75} />
                <h3 className="b88-heading mt-6">{String(title)}</h3>
                <p className="mt-2">{String(body)}</p>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
