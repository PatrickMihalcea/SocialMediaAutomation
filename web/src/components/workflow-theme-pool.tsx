'use client';

import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { Button, Dialog, EmptyState, humanizeMachineValue, MediaFrame, StatusMessage, TextArea } from '@/bridge88/components';
import { listReferenceImagesAction } from '@/app/actions/workflows';

interface ReferenceImage {
  id: string;
  filename: string;
  url: string;
}

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
  disabled,
  onChangeThemes,
  onChangeImages,
}: {
  slug: string;
  label: string;
  hint?: string;
  themes: string[];
  images: Record<string, string>;
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

function ImagePicker({
  slug,
  open,
  theme,
  selectedId,
  onClose,
  onSelect,
}: {
  slug: string;
  open: boolean;
  theme: string | null;
  selectedId?: string;
  onClose: () => void;
  onSelect: (assetId: string) => void;
}) {
  const { images, loading, error, load } = useReferenceImages();

  useEffect(() => {
    if (open) void load(slug);
  }, [open, slug, load]);

  return (
    <Dialog
      open={open}
      eyebrow="Reference layout"
      title={theme ? `Choose an image for ${theme}` : 'Choose an image'}
      width={760}
      onClose={onClose}
      actions={<Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>}
    >
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {loading && !images.length && <p className="b88-caption">Loading images</p>}
      {!loading && !images.length && !error && (
        <EmptyState eyebrow="Media library" title="No images in this workspace yet">
          Upload a sketch to the media library and it will appear here.
        </EmptyState>
      )}
      {!!images.length && (
        <div className="grid max-h-[55vh] grid-cols-2 gap-4 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() => onSelect(image.id)}
              className="text-left transition-opacity hover:opacity-80"
              aria-pressed={image.id === selectedId}
            >
              {/*
                The kit's frame rather than a bare <img>: it locks the tile to a
                square whatever the file's own shape is, and a file that fails
                to load leaves a labelled placeholder instead of collapsing the
                row to the height of its alt text.
              */}
              <MediaFrame
                ratio="1:1"
                type="image"
                tone="soft"
                src={image.url}
                alt={humanizeMachineValue(image.filename)}
                style={image.id === selectedId
                  ? { outline: '2px solid var(--ink)', outlineOffset: 2 }
                  : undefined}
              />
              {/* Named, because a grid of thumbnails is otherwise a guess. */}
              <span className="mt-1.5 line-clamp-2 block break-words text-sm leading-snug">
                {humanizeMachineValue(image.filename)}
              </span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/**
 * The workspace's images, fetched once and shared by every row and the picker.
 *
 * Module-level rather than context: this field is the only consumer, and a
 * provider threaded through the config panel for one list would be more
 * plumbing than the thing it carries.
 */
let cache: { slug: string; images: ReferenceImage[] } | null = null;
const listeners = new Set<() => void>();

function useReferenceImages() {
  const [, force] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const listener = () => force((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  async function load(slug: string) {
    if (cache?.slug === slug || loading) return;
    setLoading(true);
    setError('');
    try {
      cache = { slug, images: await listReferenceImagesAction(slug) };
      listeners.forEach((listener) => listener());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The images could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  return { images: cache?.images ?? [], loading, error, load };
}

/** Commas separate; newlines do too, so a list pasted from a document survives. */
function splitEntries(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
