import Link from 'next/link';

/**
 * Runs / Steps, as links rather than client state.
 *
 * Deliberate: the Steps tab mounts the canvas, which carries React Flow. Routing
 * between them keeps that bundle off the Runs view entirely. Selected takes the
 * primary surface, the same rule the segmented control follows.
 */
export function WorkflowTabs({ base, active }: { base: string; active: 'runs' | 'steps' }) {
  const tabs = [
    { id: 'runs' as const, label: 'Runs', href: base },
    { id: 'steps' as const, label: 'Steps', href: `${base}?view=steps` },
  ];

  return (
    <nav className="mt-6 flex gap-2 border-b border-hairline pb-3" aria-label="Workflow views">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={selected ? 'page' : undefined}
            className="rounded-pill px-4 py-2 text-sm no-underline transition-opacity hover:opacity-80"
            style={
              selected
                ? { background: 'var(--primary)', color: 'var(--on-primary)' }
                : { color: 'var(--ink)' }
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
