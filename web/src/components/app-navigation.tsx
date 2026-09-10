'use client';

import { useEffect, useState } from 'react';
import Link, { useLinkStatus } from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Select } from '@/bridge88/components';
import {
  BarChart3,
  Bot,
  CalendarDays,
  Contact,
  FilePenLine,
  History,
  Image,
  LayoutDashboard,
  ListTodo,
  Megaphone,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Share2,
  WandSparkles,
} from 'lucide-react';

const items = [
  ['Dashboard', '', LayoutDashboard],
  ['Calendar', '/calendar', CalendarDays],
  ['Queue', '/queue', ListTodo],
  ['Drafts', '/drafts', FilePenLine],
  ['Create post', '/compose', Plus],
  ['AI assistant', '/assistant', Bot],
  ['AI studio', '/studio', WandSparkles],
  ['Media', '/media', Image],
  ['Analytics', '/analytics', BarChart3],
  ['History', '/history', History],
  ['Campaigns', '/campaigns', Megaphone],
  ['Social accounts', '/channels', Share2],
  ['Team', '/team', Contact],
  ['Workspace settings', '/settings', Settings],
] as const;

// Looked up by path, not index: the mobile and overflow lists used positional
// indexes, so inserting a destination silently repointed them.
const destination = (path: string) => items.find((item) => item[1] === path)!;

const mobileItems = [
  destination(''),
  destination('/calendar'),
  destination('/compose'),
  destination('/media'),
  destination('/queue'),
] as const;
const overflowItems = [
  destination('/drafts'),
  destination('/assistant'),
  destination('/studio'),
  destination('/analytics'),
  destination('/history'),
  destination('/campaigns'),
  destination('/channels'),
  destination('/team'),
  destination('/settings'),
  ['Search', '/search', Search] as const,
] as const;

// Pending feedback sits on the destination the user clicked, so the current page
// stays readable instead of being replaced by a full-page loading state.
function NavPendingDot() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span className="b88-spinner-inline shrink-0" aria-label="Loading" role="status" />;
}

export function AppNavigation({
  slug,
  workspaces,
}: {
  slug: string;
  workspaces: { slug: string; name: string }[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const root = `/w/${slug}`;
  const moreActive = overflowItems.some(([, path]) => pathname.startsWith(`${root}${path}`));

  useEffect(() => {
    if (!overflowOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOverflowOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [overflowOpen]);

  return (
    <>
      <aside
        className="b88-desktop-sidebar fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-hairline bg-canvas p-4"
      >
        <Link href={root} className="mb-6 px-4 py-2 text-xl font-[540]">Bridge88</Link>
        <div className="mb-4 rounded-md bg-surface-soft p-4">
          <Select
            id="workspace-switcher"
            label="Workspace"
            variant="pill"
            className="w-full font-[480]"
            value={slug}
            onChange={(event) => router.push(`/w/${event.target.value}`)}
            aria-label="Switch workspace"
          >
            {workspaces.map((workspace) => <option key={workspace.slug} value={workspace.slug}>{workspace.name}</option>)}
          </Select>
          <Link href="/w/new" className="mt-2 inline-block text-sm">Create workspace</Link>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {items.map(([label, path, Icon]) => {
            const href = `${root}${path}`;
            const active = path === '' ? pathname === root : pathname.startsWith(href);
            return (
              <Link
                key={label}
                href={href}
                aria-current={active ? 'page' : undefined}
                className="flex items-center gap-3 rounded-pill px-4 py-3 text-sm transition-opacity hover:opacity-80"
                style={active ? { background: 'var(--primary)', color: 'var(--on-primary)' } : undefined}
              >
                <Icon size={17} strokeWidth={1.75} /> <span className="min-w-0 flex-1 truncate">{label}</span>
                <NavPendingDot />
              </Link>
            );
          })}
        </nav>
        <p className="b88-caption mt-auto px-4 py-2">Production queue · mock integrations</p>
      </aside>

      {overflowOpen && (
        <div
          className="b88-mobile-nav fixed inset-0 bottom-[68px] z-30"
          style={{ background: 'var(--scrim-modal)' }}
          onClick={() => setOverflowOpen(false)}
        >
          <section
            id="mobile-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More destinations"
            className="b88-card absolute inset-x-3 bottom-3"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="b88-eyebrow mb-4">More</p>
            <div className="grid grid-cols-2 gap-2">
              {overflowItems.map(([label, path, Icon]) => {
                const href = `${root}${path}`;
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={label}
                    href={href}
                    onClick={() => setOverflowOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className="flex items-center gap-2 rounded-pill px-4 py-3 text-sm transition-opacity hover:opacity-80"
                    style={active ? { background: 'var(--primary)', color: 'var(--on-primary)' } : undefined}
                  >
                    <Icon size={17} strokeWidth={1.75} /> {label}
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* Six tabs share the width evenly and truncate; fixed minimums overflowed
          narrow phones and pushed the whole page sideways. */}
      <nav className="b88-mobile-nav fixed inset-x-0 bottom-0 z-40 h-[68px] items-stretch justify-between border-t border-hairline bg-canvas px-1">
        {mobileItems.map(([label, path, Icon]) => {
          const href = `${root}${path}`;
          const active = path === '' ? pathname === root : pathname.startsWith(href);
          return (
            <Link
              key={label}
              href={href}
              aria-current={active ? 'page' : undefined}
              aria-label={label}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-pill px-1 text-[10px] transition-opacity hover:opacity-80"
              style={active ? { background: 'var(--primary)', color: 'var(--on-primary)' } : undefined}
            >
              <Icon size={19} strokeWidth={1.75} className="shrink-0" />
              <span className="max-w-full truncate">{label.replace(' post', '').replace('Social ', '')}</span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-label="More"
          aria-haspopup="dialog"
          aria-controls="mobile-more-sheet"
          aria-expanded={overflowOpen}
          onClick={() => setOverflowOpen((open) => !open)}
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-pill px-1 text-[10px] transition-opacity hover:opacity-80"
          style={moreActive ? { background: 'var(--primary)', color: 'var(--on-primary)' } : undefined}
        >
          <MoreHorizontal size={19} strokeWidth={1.75} className="shrink-0" />
          <span className="max-w-full truncate">More</span>
        </button>
      </nav>
    </>
  );
}
