'use client';

import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';

export interface TagOption {
  id: string;
  name: string;
  /** Assets carrying this tag across the whole library, not the selection. */
  assetCount?: number;
}

/**
 * Add and remove tags on one or more assets.
 *
 * Every chip applies on click. The previous control was a native select plus a
 * Tag and a Remove tag button in the selection bar, so tagging one file began
 * by selecting it, applying two tags meant two round trips through the same
 * dropdown, and nothing on screen said which tags an asset already carried.
 *
 * With several assets chosen a chip has three states, and the middle one is the
 * reason this is not a checkbox list: a tag on some of the selection is neither
 * on nor off, and clicking it should complete the set rather than clear it.
 */
export function MediaTagPicker({
  tags,
  assetIds,
  tagCounts,
  canCreate,
  pending,
  onToggle,
  onCreate,
}: {
  tags: TagOption[];
  assetIds: string[];
  /** How many of `assetIds` already carry each tag, keyed by tag id. */
  tagCounts: Map<string, number>;
  canCreate: boolean;
  pending: boolean;
  onToggle: (tagId: string, apply: boolean) => void;
  onCreate: (name: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const total = assetIds.length;
  const existing = new Set(tags.map((tag) => tag.name.toLocaleLowerCase()));
  const trimmed = draft.trim();

  const submitDraft = () => {
    if (!trimmed || pending) return;
    onCreate(trimmed);
    setDraft('');
  };

  return (
    <div>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => {
            const held = tagCounts.get(tag.id) ?? 0;
            const state = held === 0 ? 'none' : held === total ? 'all' : 'some';
            return (
              <button
                key={tag.id}
                type="button"
                disabled={pending}
                aria-pressed={state === 'all'}
                title={
                  state === 'all'
                    ? `Remove ${tag.name}`
                    : state === 'some'
                      ? `Add ${tag.name} to the remaining ${total - held}`
                      : `Add ${tag.name}`
                }
                onClick={() => onToggle(tag.id, state !== 'all')}
                className={`b88-caption inline-flex min-h-9 items-center gap-2 rounded-pill border px-3 transition-opacity hover:opacity-80 active:scale-[.97] disabled:opacity-40 ${
                  state === 'all' ? 'border-ink bg-primary text-on-primary' : 'border-hairline'
                }`}
              >
                <span className="max-w-40 truncate">{tag.name}</span>
                {state === 'some' && <span aria-hidden>{held}/{total}</span>}
                {state === 'all'
                  ? <Check size={13} strokeWidth={2} aria-hidden />
                  : <Plus size={13} strokeWidth={2} aria-hidden />}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="b88-caption">
          {canCreate ? 'No tags yet — name one below' : 'No tags yet'}
        </p>
      )}

      {canCreate && (
        <div className="mt-3 flex gap-2">
          <div className="relative flex min-w-0 flex-1 items-center">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              // Enter must not reach a surrounding form: the selection bar is a
              // form whose submit runs a bulk operation on every chosen asset.
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                submitDraft();
              }}
              maxLength={120}
              placeholder="New tag"
              aria-label="New tag name"
              className="b88-filter-control min-w-0 flex-1 bg-canvas pr-10 text-ink"
              style={{ backgroundImage: 'none' }}
            />
            {draft && (
              <button
                type="button"
                aria-label="Clear tag name"
                onClick={() => setDraft('')}
                className="absolute right-3 text-ink transition-opacity hover:opacity-80"
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={pending || !trimmed}
            onClick={submitDraft}
            className="b88-caption inline-flex min-h-9 shrink-0 items-center gap-2 rounded-pill bg-primary px-4 text-on-primary transition-opacity hover:opacity-80 active:scale-[.97] disabled:opacity-40"
          >
            {existing.has(trimmed.toLocaleLowerCase()) ? 'Apply' : 'Create'}
          </button>
        </div>
      )}
    </div>
  );
}
