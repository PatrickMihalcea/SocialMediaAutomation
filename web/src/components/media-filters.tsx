'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Search } from 'lucide-react';
import { Button, Field, Select } from '@/bridge88/components';

// Filtering pushes the new query through a transition so React keeps the current
// results on screen instead of dropping to the route-level loading fallback.
export function MediaFilters({
  slug,
  tags,
  current,
}: {
  slug: string;
  tags: { id: string; name: string }[];
  current: { q?: string; type?: string; tag?: string; folder?: string; filter?: string; sort?: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState(current.q ?? '');

  const submit = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const params = new URLSearchParams();
    for (const key of ['q', 'type', 'tag', 'filter', 'sort', 'folder'] as const) {
      const value = String(data.get(key) ?? '').trim();
      if (value) params.set(key, value);
    }
    const search = params.toString();
    startTransition(() => router.push(search ? `/w/${slug}/media?${search}` : `/w/${slug}/media`));
  }, [router, slug]);

  // Typing is debounced; navigating on every keystroke made the row stutter.
  useEffect(() => {
    if (query === (current.q ?? '')) return;
    const timer = setTimeout(submit, 400);
    return () => clearTimeout(timer);
  }, [query, current.q, submit]);

  // Fixed track widths, not auto: auto tracks resize to the selected option's text,
  // so every dropdown change shifted the whole row sideways.
  return (
    <form
      ref={formRef}
      className="mt-6 grid grid-cols-1 gap-3 rounded-md bg-surface-soft p-4 md:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_140px_150px_150px_150px_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      aria-busy={pending}
    >
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-4" size={16} />
        <Field
          name="q"
          label="Search media"
          variant="filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full pl-10"
          containerClassName="w-full [&>.b88-label]:sr-only"
          placeholder="Search filename, tag or folder"
        />
      </div>
      <Select name="type" label="Media type" variant="filter" className="w-full" containerClassName="[&>.b88-label]:sr-only" defaultValue={current.type ?? ''} aria-label="Media type" onChange={submit}>
        <option value="">All types</option><option value="IMAGE">Images</option><option value="VIDEO">Videos</option><option value="GIF">GIFs</option><option value="AUDIO">Audio</option>
      </Select>
      <Select name="tag" label="Tag" variant="filter" className="w-full" containerClassName="[&>.b88-label]:sr-only" defaultValue={current.tag ?? ''} aria-label="Tag" onChange={submit}>
        <option value="">All tags</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
      </Select>
      <Select name="filter" label="Asset source or usage" variant="filter" className="w-full" containerClassName="[&>.b88-label]:sr-only" defaultValue={current.filter ?? ''} aria-label="Asset source or usage" onChange={submit}>
        <option value="">All assets</option><option value="generated">Generated</option><option value="uploaded">Uploaded originals</option><option value="used">Used in posts</option><option value="unused">Unused</option>
      </Select>
      <Select name="sort" label="Sort order" variant="filter" className="w-full" containerClassName="[&>.b88-label]:sr-only" defaultValue={current.sort ?? 'newest'} aria-label="Sort order" onChange={submit}>
        <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name">Filename</option><option value="size">Largest</option><option value="usage">Most used</option>
      </Select>
      {current.folder && <input type="hidden" name="folder" value={current.folder} />}
      {/* The label never changes text: swapping it resized the button and relaid
          out the auto-sized grid columns on every filter change. */}
      <Button type="submit">Filter</Button>
    </form>
  );
}
