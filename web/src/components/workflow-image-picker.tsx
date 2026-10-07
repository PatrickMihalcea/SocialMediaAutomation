'use client';

import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { Button, Dialog, EmptyState, Field, humanizeMachineValue, MediaFrame, StatusMessage } from '@/bridge88/components';
import { listReferenceImagesAction } from '@/app/actions/workflows';

interface ReferenceImage {
  id: string;
  filename: string;
  url: string;
  folderId: string | null;
}

export interface ThemePoolFolder {
  id: string;
  name: string;
  parentId: string | null;
}

/** Root first, then each folder under its parent, depth carried for indenting. */
function foldersInOrder(
  folders: ThemePoolFolder[],
  parentId: string | null = null,
  depth = 0,
): Array<ThemePoolFolder & { depth: number }> {
  return folders
    .filter((folder) => folder.parentId === parentId)
    .flatMap((folder) => [
      { ...folder, depth },
      ...foldersInOrder(folders, folder.id, depth + 1),
    ]);
}


export function ImagePicker({
  slug,
  folders,
  open,
  theme,
  eyebrow = 'Layout sketch',
  selectedId,
  onClose,
  onSelect,
}: {
  slug: string;
  folders: ThemePoolFolder[];
  open: boolean;
  theme: string | null;
  /** What is being chosen, named above the dialog's title. */
  eyebrow?: string;
  selectedId?: string;
  onClose: () => void;
  onSelect: (assetId: string) => void;
}) {
  const { images, loading, error, load } = useReferenceImages();
  /** undefined is every folder; null is the ones filed in none. */
  const [folderId, setFolderId] = useState<string | null | undefined>(undefined);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) void load(slug);
  }, [open, slug, load]);

  // A picker that reopens on the last folder someone browsed, with their last
  // search still applied, looks like a library that has lost most of itself.
  useEffect(() => {
    if (!open) return;
    setFolderId(undefined);
    setSearch('');
  }, [open]);

  const term = search.trim().toLowerCase();
  const visible = images.filter((image) =>
    (folderId === undefined || image.folderId === folderId)
    && (!term || humanizeMachineValue(image.filename).toLowerCase().includes(term)));

  const countIn = (id: string | null | undefined) =>
    id === undefined ? images.length : images.filter((image) => image.folderId === id).length;
  const unfiled = countIn(null);

  return (
    <Dialog
      open={open}
      eyebrow={eyebrow}
      title={theme ?? undefined}
      width={860}
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
        <div className="grid gap-4 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
          {/* The library's own shape. A flat grid of everything is only usable
              while a workspace is small, and hides the folders someone filed
              their sketches into precisely so they could find them. */}
          <nav className="max-h-[52vh] overflow-y-auto" aria-label="Folders">
            <FolderRow
              label="All images"
              count={countIn(undefined)}
              depth={0}
              active={folderId === undefined}
              onClick={() => setFolderId(undefined)}
            />
            {foldersInOrder(folders).map((folder) => (
              <FolderRow
                key={folder.id}
                label={folder.name}
                count={countIn(folder.id)}
                depth={folder.depth + 1}
                active={folderId === folder.id}
                onClick={() => setFolderId(folder.id)}
              />
            ))}
            {unfiled > 0 && (
              <FolderRow
                label="No folder"
                count={unfiled}
                depth={1}
                active={folderId === null}
                onClick={() => setFolderId(null)}
              />
            )}
          </nav>

          <div className="min-w-0">
            {/* Plain field, not the filter variant: that one carries a chevron
                and reads as a dropdown rather than a box you type in. */}
            <Field
              label="Search"
              labelHidden
              type="search"
              placeholder="Search images"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {visible.length === 0 ? (
              <p className="b88-caption mt-4">
                {term ? 'Nothing here matches that.' : 'This folder has no images.'}
              </p>
            ) : (
              <div className="mt-3 grid max-h-[46vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
                {visible.map((image) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => onSelect(image.id)}
                    className="text-left transition-opacity hover:opacity-80"
                    aria-pressed={image.id === selectedId}
                  >
                    {/*
                      The kit's frame rather than a bare <img>: it locks the tile
                      to a square whatever the file's own shape is, and a file
                      that fails to load leaves a labelled placeholder instead of
                      collapsing the row to the height of its alt text.
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
                    <span className="b88-caption mt-1.5 block truncate">
                      {humanizeMachineValue(image.filename)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function FolderRow({
  label,
  count,
  depth,
  active,
  onClick,
}: {
  label: string;
  count: number;
  depth: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={`flex w-full items-center justify-between gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-opacity hover:opacity-80 ${
        active ? 'bg-ink text-canvas' : ''
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={`b88-caption ${active ? 'text-canvas' : ''}`}>{count}</span>
    </button>
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

export function useReferenceImages() {
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

/**
 * One image, chosen from the media library and held as an asset id.
 *
 * The counterpart to a port: a look is usually a picture somebody already has,
 * not something a run produces, so requiring a step upstream to carry it would
 * mean building a branch whose only job is to hold a constant. The port still
 * wins where both exist — this says so rather than quietly losing the choice.
 */
export function WorkflowImageField({
  slug,
  label,
  hint,
  eyebrow,
  assetId,
  folders,
  disabled,
  overriddenBy,
  onChange,
}: {
  slug: string;
  label: string;
  hint?: string;
  /** Names the picker dialog, e.g. "Style reference". */
  eyebrow: string;
  assetId: string | null;
  folders: ThemePoolFolder[];
  disabled: boolean;
  /** Set when a wire is supplying this, so the setting is shown as ignored. */
  overriddenBy?: string;
  onChange: (assetId: string | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const { load } = useReferenceImages();

  // Fetched up front when one is already chosen, so the field opens showing
  // its thumbnail rather than filling in once the picker has been opened.
  useEffect(() => {
    if (assetId) void load(slug);
  }, [assetId, slug, load]);

  return (
    <div>
      <p className="b88-label">{label}</p>
      <div className="grid min-w-0 grid-cols-[56px_minmax(0,1fr)] gap-3 rounded-md border border-hairline bg-canvas p-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPicking(true)}
          aria-label={assetId ? `Change the ${label.toLowerCase()}` : `Choose a ${label.toLowerCase()}`}
          className="flex size-14 items-center justify-center overflow-hidden rounded-md border border-hairline bg-surface-soft transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {assetId ? <PickedThumb assetId={assetId} /> : <ImagePlus size={16} />}
        </button>
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => setPicking(true)}>
              {assetId ? 'Change image' : 'Choose an image'}
            </Button>
            {assetId && (
              <Button type="button" variant="tertiary" size="sm" disabled={disabled} onClick={() => onChange(null)}>
                Remove
              </Button>
            )}
          </div>
          {overriddenBy && (
            <p className="b88-caption mt-2">Ignored while {overriddenBy} is connected.</p>
          )}
        </div>
      </div>
      {hint && <p className="mt-1.5 text-sm">{hint}</p>}

      <ImagePicker
        slug={slug}
        folders={folders}
        open={picking}
        theme={null}
        eyebrow={eyebrow}
        selectedId={assetId ?? undefined}
        onClose={() => setPicking(false)}
        onSelect={(chosen) => {
          onChange(chosen);
          setPicking(false);
        }}
      />
    </div>
  );
}

/** The chosen image's thumbnail; an id is the one thing the client cannot render. */
function PickedThumb({ assetId }: { assetId: string }) {
  const url = useReferenceImages().images.find((image) => image.id === assetId)?.url;
  if (!url) return <ImagePlus size={16} />;
  return <img src={url} alt="" className="size-full object-cover" loading="lazy" />;
}
