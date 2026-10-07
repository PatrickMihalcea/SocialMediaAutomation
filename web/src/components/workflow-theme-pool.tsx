'use client';

import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { Button, TextArea } from '@/bridge88/components';
import { ImagePicker, useReferenceImages, type ThemePoolFolder } from '@/components/workflow-image-picker';

export type { ThemePoolFolder };

/**
 * The theme pool, and the layout sketch each theme may carry.
 *
 * The box stays the authority on which themes exist: a pool is pasted as a
 * comma-separated list, and turning that into a row-by-row editor to make room
 * for images would have cost the one interaction that matters most. The
 * sketches hang off it instead — one row per theme the box parsed, each either
 * showing its thumbnail or offering to add one.
 *
 * Pairings are keyed by the theme's text, so reordering or re-pasting the list
 * keeps them. Rewording a theme drops its sketch, which the row shows by going
 * back to "Add sketch" rather than failing silently later.
 */
export function WorkflowThemePool({
  slug,
  label,
  hint,
  themes,
  images,
  folders,
  disabled,
  onChangeThemes,
  onChangeImages,
}: {
  slug: string;
  label: string;
  hint?: string;
  themes: string[];
  images: Record<string, string>;
  folders: ThemePoolFolder[];
  disabled: boolean;
  onChangeThemes: (themes: string[]) => void;
  onChangeImages: (images: Record<string, string>) => void;
}) {
  const [text, setText] = useState(() => themes.join(', '));
  const [picking, setPicking] = useState<string | null>(null);
  const entries = splitEntries(text);
  const { load } = useReferenceImages();

  // Fetched up front when a pairing already exists, so the rows open showing
  // their thumbnails rather than filling in once the picker has been opened.
  const hasPairings = Object.keys(images).length > 0;
  useEffect(() => {
    if (hasPairings) void load(slug);
  }, [hasPairings, slug, load]);

  function attach(theme: string, assetId: string | null) {
    const next = { ...images };
    if (assetId) next[theme] = assetId;
    else delete next[theme];
    onChangeImages(next);
  }

  return (
    <div>
      <TextArea
        label={label}
        hint={hint}
        rows={4}
        value={text}
        disabled={disabled}
        placeholder="Interior design, Luxury homes, Brutalist landmarks"
        onChange={(event) => {
          setText(event.target.value);
          onChangeThemes(splitEntries(event.target.value));
        }}
      />
      <p className="b88-caption mt-1.5">
        {entries.length === 0
          ? 'Separate with commas'
          : entries.length === 1 ? '1 entry' : `${entries.length} entries`}
      </p>

      {entries.length > 0 && (
        <div className="mt-4">
          <div>
            <p className="b88-label">Reference layouts</p>
            <p className="mt-1 text-sm">
              Optional images that guide composition for each theme.
            </p>
          </div>
          <div className="mt-2 grid gap-2">
            {entries.map((theme) => (
              <ThemeRow
                key={theme}
                theme={theme}
                assetId={images[theme]}
                disabled={disabled}
                onPick={() => setPicking(theme)}
                onClear={() => attach(theme, null)}
              />
            ))}
          </div>
        </div>
      )}

      <ImagePicker
        slug={slug}
        folders={folders}
        open={picking !== null}
        theme={picking}
        selectedId={picking ? images[picking] : undefined}
        onClose={() => setPicking(null)}
        onSelect={(assetId) => {
          if (picking) attach(picking, assetId);
          setPicking(null);
        }}
      />
    </div>
  );
}

function ThemeRow({
  theme,
  assetId,
  disabled,
  onPick,
  onClear,
}: {
  theme: string;
  assetId?: string;
  disabled: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[56px_minmax(0,1fr)] gap-3 rounded-md border border-hairline bg-canvas p-3">
      <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        aria-label={assetId ? `Change the sketch for ${theme}` : `Add a sketch for ${theme}`}
        className="flex size-14 items-center justify-center overflow-hidden rounded-md border border-hairline bg-surface-soft transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {assetId ? <ThemeThumb assetId={assetId} /> : <ImagePlus size={16} />}
      </button>
      <div className="min-w-0">
        <p className="break-words text-sm font-[480] leading-snug">{theme}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={onPick}
          >
            {assetId ? 'Change image' : 'Add image'}
          </Button>
          {assetId && (
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              disabled={disabled}
              onClick={onClear}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One row's thumbnail.
 *
 * Resolved here rather than handed down, because the pool holds asset ids and
 * a signed URL is the one thing an id cannot be turned into on the client. The
 * list is cached per workspace for the life of the panel, so twenty rows cost
 * one request rather than twenty.
 */
function ThemeThumb({ assetId }: { assetId: string }) {
  const url = useReferenceImages().images.find((image) => image.id === assetId)?.url;
  if (!url) return <ImagePlus size={16} />;
  return <img src={url} alt="" className="size-full object-cover" loading="lazy" />;
}

function splitEntries(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
