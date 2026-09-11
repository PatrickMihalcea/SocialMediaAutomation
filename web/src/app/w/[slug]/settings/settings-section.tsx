import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Settings is a long page of independent forms. Each one sits behind its own
 * disclosure so the summary rows double as the page's navigation: every section
 * stays one tab away and one Enter from open, and nothing is removed.
 */
export function SettingsSection({
  id,
  eyebrow,
  title,
  summary,
  tone = 'card',
  defaultOpen = false,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  /** names what the closed section holds, so a collapsed row is never a mystery */
  summary: string;
  tone?: 'card' | 'ownership';
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const surface = tone === 'ownership'
    ? 'rounded-lg bg-[var(--block-pink)]'
    : 'rounded-3xl border border-hairline bg-canvas';
  return (
    <details id={id} className={`group ${surface}`} open={defaultOpen || undefined}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="b88-caption block">{eyebrow}</span>
          <span className="b88-heading mt-1 block">{title}</span>
          <span className="mt-1 block text-sm group-open:hidden">{summary}</span>
        </span>
        <ChevronDown
          size={20}
          strokeWidth={1.75}
          aria-hidden
          className="shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  );
}
