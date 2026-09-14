'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { uploadMedia } from '@/lib/media/upload-client';
import {
  Check, Copy, Download, Eye, Folder, MoreHorizontal, Move, Pencil, Plus,
  Tags, Trash2, X,
} from 'lucide-react';
import { Badge, Button, EmptyState, Field, humanizeMachineValue, IconButton, MediaFrame, MediaUploader, Select, StatusMessage, VideoPlayer } from '@/bridge88/components';
import { listAttachableDraftsAction } from '@/app/actions/posts';
import { MEDIA_PRESETS } from '@/lib/social/capabilities';
import {
  applyTagAction, createDerivativeAction, createFolderAction, createTagAction, deleteFolderAction,
  deleteMediaAction, deleteTagAction, mutateAssetsAction,
  renameTagAction, retryMediaAction, updateFolderAction, updateMediaDetailsAction,
} from '@/app/actions/media';
import { MediaTagPicker } from '@/components/media-tag-picker';
import { MEDIA_KIND_LABELS, MEDIA_STATUS_LABELS, MEDIA_TYPE_LABELS } from '@/lib/media/labels';

export interface MediaLibraryAsset {
  id: string;
  filename: string;
  mimeType: string;
  type: 'IMAGE' | 'VIDEO' | 'GIF' | 'AUDIO';
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  sizeLabel: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  usageCount: number;
  folderId: string | null;
  altText: string | null;
  derivedFromId: string | null;
  derivationPreset: string | null;
  assetKind: 'ORIGINAL' | 'DERIVATIVE' | 'GENERATED';
  errorMessage: string | null;
  previewUrl: string;
  downloadUrl: string;
  tags: { id: string; name: string }[];
  usages: { id: string; title: string; status: string; platform: string }[];
}

/** Roughly nine minutes of watching before the library stops asking. */
const MAX_STATUS_POLLS = 100;

interface FolderItem { id: string; parentId: string | null; name: string; label: string }
interface TagItem { id: string; name: string; assetCount: number }

export function MediaLibrary({
  slug, assets, folders, tags, canEdit, canDelete, currentFolder,
}: {
  slug: string;
  assets: MediaLibraryAsset[];
  folders: FolderItem[];
  tags: TagItem[];
  canEdit: boolean;
  canDelete: boolean;
  currentFolder: string | null;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [createdDerivativeId, setCreatedDerivativeId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<MediaLibraryAsset | null>(null);
  const [visibleAssetCount, setVisibleAssetCount] = useState(12);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [managingTags, setManagingTags] = useState(false);
  const [pending, startTransition] = useTransition();
  // Folder changes run as a transition so only the asset grid dims; a plain
  // <a href> reloaded the document and flashed the full-page loading screen.
  const [navigating, startNavigation] = useTransition();
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigate = (href: string) => startNavigation(() => router.push(href));
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const currentTag = searchParams.get('tag');
  // Filters compose rather than replace each other. Picking a folder used to
  // link straight to ?folder=id, which threw away the search term, the type and
  // the sort order the user had just set.
  const hrefWith = useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const search = params.toString();
    return search ? `/w/${slug}/media?${search}` : `/w/${slug}/media`;
  }, [searchParams, slug]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visibleAssets = assets.slice(0, visibleAssetCount);
  // Only what is on screen is watched; loading three more pages of an old
  // library should not start 36 more polls.
  const pendingIds = useMemo(
    () => visibleAssets
      .filter((asset) => asset.status === 'PROCESSING' || asset.status === 'UPLOADING')
      .map((asset) => asset.id),
    [visibleAssets],
  );
  const stalled = useProcessingWatch(slug, pendingIds, () => router.refresh());
  // The drawer reads through to the live list, so a tag added in the preview
  // and a status that finished processing both land without reopening it.
  const previewAsset = preview ? assets.find((asset) => asset.id === preview.id) ?? preview : null;
  const toggle = (id: string) => setSelected((value) =>
    value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  const stageFiles = (files: FileList | File[]) => {
    if (!files.length || !inputRef.current || !formRef.current) return;
    const transfer = new DataTransfer();
    Array.from(files).forEach((file) => transfer.items.add(file));
    inputRef.current.files = transfer.files;
    setQueuedFiles(Array.from(transfer.files));
  };
  const clearStagedFiles = () => {
    if (inputRef.current) inputRef.current.value = '';
    setQueuedFiles([]);
  };
  const runDerivative = (assetId: string, data: FormData) => {
    startTransition(async () => {
      try {
        const result = await createDerivativeAction(slug, assetId, data);
        setCreatedDerivativeId(result.derivativeId);
        setPreview(null);
        setNotice({ tone: 'success', message: `${result.message} The new derivative is highlighted at the top of the library.` });
        router.refresh();
      } catch (error) {
        setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'The derivative could not be created.' });
      }
    });
  };
  const runUpload = (data: FormData) => {
    setUploading(true);
    startTransition(async () => {
      try {
        const result = await uploadMedia(slug, data);
        setNotice({ tone: 'success', message: result.message });
        clearStagedFiles();
        router.refresh();
      } catch (error) {
        setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'The media could not be uploaded.' });
      } finally {
        setUploading(false);
      }
    });
  };
  const runBulkAction = (data: FormData) => {
    startTransition(async () => {
      try {
        const result = await mutateAssetsAction(slug, data);
        setNotice({ tone: 'success', message: result.message });
        setSelected([]);
        router.refresh();
      } catch (error) {
        setNotice({ tone: 'error', message: errorMessage(error, 'The selected assets could not be updated.') });
      }
    });
  };
  const runRetry = (assetId: string, closePreview = false) => {
    startTransition(async () => {
      try {
        const result = await retryMediaAction(slug, assetId);
        setNotice({ tone: 'success', message: result.message });
        if (closePreview) setPreview(null);
        router.refresh();
      } catch (error) {
        setNotice({ tone: 'error', message: errorMessage(error, 'Processing could not be retried.') });
      }
    });
  };
  const runDelete = (asset: MediaLibraryAsset, closePreview = false) => {
    const displayName = assetDisplayName(assets, asset.id);
    if (asset.usages.length > 0) {
      setNotice({
        tone: 'error',
        message: `${displayName} is attached to ${asset.usages.length} ${asset.usages.length === 1 ? 'post' : 'posts'}. Open the asset preview to review them before removing media from those posts.`,
      });
      return;
    }
    if (!window.confirm(`Delete ${displayName}? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        const result = await deleteMediaAction(slug, asset.id);
        if (closePreview) setPreview(null);
        setSelected((value) => value.filter((id) => id !== asset.id));
        setNotice({ tone: 'success', message: result.message });
        router.refresh();
      } catch (error) {
        setNotice({ tone: 'error', message: errorMessage(error, 'The asset could not be deleted.') });
      }
    });
  };
  const runDetails = (assetId: string, data: FormData) => {
    startTransition(async () => {
      try {
        const result = await updateMediaDetailsAction(slug, assetId, data);
        setPreview((value) => value?.id === assetId
          ? { ...value, filename: result.filename, altText: result.altText }
          : value);
        setNotice({ tone: 'success', message: result.message });
        router.refresh();
      } catch (error) {
        setNotice({ tone: 'error', message: errorMessage(error, 'The asset details could not be saved.') });
      }
    });
  };

  const runApplyTag = (assetIds: string[], tagId: string, apply: boolean) => {
    startTransition(async () => {
      try {
        const result = await applyTagAction(slug, { assetIds, tagId, apply });
        // Patched as well as refreshed: removing the tag being filtered on drops
        // the asset out of the list, and the drawer would otherwise fall back to
        // a snapshot still showing the tag it just lost.
        setPreview((value) => value && assetIds.includes(value.id)
          ? {
              ...value,
              tags: apply
                ? [...value.tags.filter((tag) => tag.id !== tagId), result.tag]
                  .sort((a, b) => a.name.localeCompare(b.name))
                : value.tags.filter((tag) => tag.id !== tagId),
            }
          : value);
        setNotice({ tone: 'success', message: result.message });
        router.refresh();
      } catch (error) {
        setNotice({ tone: 'error', message: errorMessage(error, 'The tag could not be applied.') });
      }
    });
  };
  const runCreateTag = (name: string, applyTo?: string[]) => {
    startTransition(async () => {
      try {
        const data = new FormData();
        data.set('name', name);
        const tag = await createTagAction(slug, data);
        if (applyTo?.length) {
          runApplyTag(applyTo, tag.id, true);
          return;
        }
        setNotice({ tone: 'success', message: `Tag ${tag.name} created.` });
        router.refresh();
      } catch (error) {
        setNotice({ tone: 'error', message: errorMessage(error, 'The tag could not be created.') });
      }
    });
  };
  const runRenameTag = (tagId: string, data: FormData) => {
    startTransition(async () => {
      try {
        const result = await renameTagAction(slug, tagId, data);
        setNotice({ tone: 'success', message: result.message });
        router.refresh();
      } catch (error) {
        setNotice({ tone: 'error', message: errorMessage(error, 'The tag could not be renamed.') });
      }
    });
  };
  const runDeleteTag = (tag: TagItem) => {
    const held = tag.assetCount === 1 ? '1 asset' : `${tag.assetCount} assets`;
    if (!window.confirm(`Delete the tag ${tag.name}? It is on ${held}, which are kept.`)) return;
    startTransition(async () => {
      try {
        const result = await deleteTagAction(slug, tag.id);
        setNotice({ tone: 'success', message: result.message });
        if (currentTag === tag.id) navigate(hrefWith({ tag: null }));
        router.refresh();
      } catch (error) {
        setNotice({ tone: 'error', message: errorMessage(error, 'The tag could not be deleted.') });
      }
    });
  };

  return (
    <>
      {notice && <StatusMessage className="mt-6" tone={notice.tone}>{notice.message}</StatusMessage>}
      {stalled && pendingIds.length > 0 && (
        <StatusMessage className="mt-6" tone="error">
          {pendingIds.length === 1 ? 'An asset is' : `${pendingIds.length} assets are`} still processing after
          several minutes. Check that the background worker is running, then reload the page.
        </StatusMessage>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <section className="b88-card p-4">
            <p className="b88-caption">Folders</p>
            <nav className="mt-3 space-y-1">
              <FolderLink href={hrefWith({ folder: null })} active={!currentFolder} onNavigate={navigate}>
                <Folder size={16} className="shrink-0" /> All media
              </FolderLink>
              {folders.map((folder) => (
                <FolderLink
                  key={folder.id}
                  href={hrefWith({ folder: currentFolder === folder.id ? null : folder.id })}
                  active={currentFolder === folder.id}
                  onNavigate={navigate}
                >
                  <span className="truncate">{folder.label}</span>
                </FolderLink>
              ))}
            </nav>
            {canEdit && (
              <details className="mt-4 border-t border-hairline pt-4">
                <summary className="cursor-pointer text-sm font-[480]">Manage folders</summary>
                <form action={createFolderAction.bind(null, slug)} className="mt-3 space-y-2">
                  <input name="name" className="b88-input" placeholder="Folder name" required />
                  <FolderSelect folders={folders} name="parentId" label="Root folder" />
                  <Button type="submit" variant="secondary" fullWidth>Create folder</Button>
                </form>
                {folders.map((folder) => (
                  <details key={folder.id} className="mt-3">
                    <summary className="cursor-pointer truncate text-sm">{folder.label}</summary>
                    <form action={updateFolderAction.bind(null, slug, folder.id)} className="mt-2 space-y-2">
                      <input name="name" className="b88-input" defaultValue={folder.name} required />
                      <FolderSelect folders={folders.filter((item) => item.id !== folder.id)} name="parentId" label="Root folder" defaultValue={folder.parentId ?? ''} />
                      <Button type="submit" variant="secondary" fullWidth>Save</Button>
                    </form>
                    <form
                      action={deleteFolderAction.bind(null, slug, folder.id)}
                      className="mt-1"
                      onSubmit={(event) => {
                        if (!window.confirm(`Delete ${folder.label}? Assets will be retained in the library.`)) event.preventDefault();
                      }}
                    >
                      <Button type="submit" variant="tertiary" fullWidth>Delete folder</Button>
                    </form>
                  </details>
                ))}
              </details>
            )}
          </section>

          {/* Tags are a filter first. They used to render as inert badges with the
              real control — a second dropdown — down in the filter row, and the
              only way to edit one was through a disclosure holding a permanently
              open rename field per tag. */}
          <section className="b88-card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="b88-caption">Tags</p>
              {canEdit && tags.length > 0 && (
                <button
                  type="button"
                  className="b88-caption underline transition-opacity hover:opacity-80"
                  onClick={() => setManagingTags((value) => !value)}
                >
                  {managingTags ? 'Done' : 'Manage'}
                </button>
              )}
            </div>
            {tags.length === 0 ? (
              <p className="b88-caption mt-3">{canEdit ? 'None yet — name one below' : 'None yet'}</p>
            ) : managingTags ? (
              <div className="mt-3 space-y-2">
                {tags.map((tag) => (
                  <TagEditRow
                    key={tag.id}
                    tag={tag}
                    pending={pending}
                    onRename={(data) => runRenameTag(tag.id, data)}
                    onDelete={() => runDeleteTag(tag)}
                  />
                ))}
              </div>
            ) : (
              <nav className="mt-3 space-y-1">
                <FolderLink href={hrefWith({ tag: null })} active={!currentTag} onNavigate={navigate}>
                  <Tags size={16} className="shrink-0" /> All tags
                </FolderLink>
                {tags.map((tag) => (
                  <FolderLink
                    key={tag.id}
                    href={hrefWith({ tag: currentTag === tag.id ? null : tag.id })}
                    active={currentTag === tag.id}
                    onNavigate={navigate}
                  >
                    <span className="truncate">{tag.name}</span>
                    <span className="b88-caption ml-auto shrink-0">{tag.assetCount}</span>
                  </FolderLink>
                ))}
              </nav>
            )}
            {canEdit && (
              <form
                className="mt-3 flex gap-2 border-t border-hairline pt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const name = String(new FormData(form).get('name') ?? '').trim();
                  if (!name) return;
                  runCreateTag(name);
                  form.reset();
                }}
              >
                <input
                  name="name"
                  className="b88-filter-control min-w-0 flex-1"
                  style={{ backgroundImage: 'none', paddingRight: 'var(--space-md)' }}
                  placeholder="New tag"
                  aria-label="New tag name"
                  maxLength={120}
                  required
                />
                <Button type="submit" variant="secondary" disabled={pending}>Add</Button>
              </form>
            )}
          </section>
        </aside>

        <main className="min-w-0 transition-opacity duration-200" aria-busy={navigating} style={navigating ? { opacity: 0.55 } : undefined}>
          {canEdit && (
            <form
              ref={formRef}
              action={runUpload}
              onSubmit={() => setUploading(true)}
              onChange={(event) => {
                if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'file') return;
                inputRef.current = event.target;
                setQueuedFiles(Array.from(event.target.files ?? []));
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                inputRef.current = formRef.current?.querySelector('input[type="file"]') ?? null;
                stageFiles(event.dataTransfer.files);
              }}
            >
              <MediaUploader
                required
                hint="JPG · PNG · WEBP · GIF · MP4 · MOV · WEBM · MP3 · 250 MB"
                title="Drop files here or choose files"
              />
              <input type="hidden" name="folderId" value={currentFolder ?? ''} />
              {queuedFiles.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-soft p-3">
                  <div className="min-w-0">
                    <p className="font-[480]">{queuedFiles.length === 1 ? humanizeMachineValue(queuedFiles[0].name) : `${queuedFiles.length} files selected`}</p>
                    {uploading && <p className="b88-caption mt-1">Keep this page open until the upload finishes.</p>}
                  </div>
                  <div className="flex gap-2">
                    {!uploading && <Button type="button" variant="tertiary" onClick={clearStagedFiles}>Cancel</Button>}
                    <Button type="submit" disabled={uploading} aria-busy={uploading} aria-label={uploading ? 'Uploading' : 'Upload'}>
                      <span className="grid">
                        <span className={`[grid-area:1/1] ${uploading ? '' : 'invisible'}`} aria-hidden>Uploading</span>
                        <span className={`[grid-area:1/1] ${uploading ? 'invisible' : ''}`} aria-hidden>Upload</span>
                      </span>
                    </Button>
                  </div>
                </div>
              )}
            </form>
          )}

          {selected.length > 0 && (
            <BulkBar
              ids={selected}
              assets={assets}
              folders={folders}
              tags={tags}
              canEdit={canEdit}
              canDelete={canDelete}
              pending={pending}
              onSubmit={runBulkAction}
              onApplyTag={(tagId, apply) => runApplyTag(selected, tagId, apply)}
              onCreateTag={(name) => runCreateTag(name, selected)}
              onClear={() => setSelected([])}
            />
          )}

          {assets.length ? (
            // pb-28 keeps the floating selection bar from covering the last row.
            <>
            <div className={`mt-6 space-y-3 sm:grid sm:grid-cols-2 sm:gap-6 sm:space-y-0 lg:grid-cols-3 2xl:grid-cols-4 ${selected.length ? 'pb-28' : ''}`}>
              {visibleAssets.map((asset) => {
                const displayName = assetDisplayName(assets, asset.id);
                return (
                <article
                  key={asset.id}
                  ref={(element) => {
                    if (element && asset.id === createdDerivativeId) {
                      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }}
                  className={`b88-card relative h-28 overflow-visible p-2 sm:h-auto sm:overflow-hidden sm:p-4 ${selectedSet.has(asset.id) || asset.id === createdDerivativeId ? 'border-ink bg-surface-soft' : ''}`}
                >
                  <div className="flex h-full min-w-0 gap-3 sm:hidden">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 gap-3 pr-9 text-left transition-opacity hover:opacity-80"
                      onClick={() => toggle(asset.id)}
                      aria-pressed={selectedSet.has(asset.id)}
                    >
                      <div className="size-24 shrink-0 overflow-hidden rounded-md">
                        <AssetPreview asset={asset} />
                      </div>
                      <span className="min-w-0 self-center">
                        <span className="block truncate text-sm font-[540]">{displayName}</span>
                        <Badge tone={asset.status === 'READY' ? 'mint' : asset.status === 'FAILED' ? 'coral' : 'cream'}>
                          {MEDIA_STATUS_LABELS[asset.status]}
                        </Badge>
                        <span className="b88-caption mt-2 block">
                          {asset.usageCount} {asset.usageCount === 1 ? 'post' : 'posts'} · {asset.sizeLabel}
                        </span>
                      </span>
                    </button>
                    <details className="absolute right-2 top-2 z-10">
                      <summary
                        aria-label={`Actions for ${displayName}`}
                        className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full bg-canvas shadow-sm [&::-webkit-details-marker]:hidden"
                      >
                        <MoreHorizontal size={18} />
                      </summary>
                      <div className="absolute right-0 top-11 grid min-w-40 gap-1 rounded-md border border-hairline bg-canvas p-2 shadow-lg">
                        <Button type="button" variant="tertiary" onClick={() => setPreview(asset)}><Eye size={15} /> Preview</Button>
                        <Button type="button" variant="tertiary" onClick={() => downloadAsset(asset)}><Download size={15} /> Download</Button>
                        {asset.status === 'FAILED' && canEdit && <Button type="button" variant="tertiary" disabled={pending} onClick={() => runRetry(asset.id)}>Retry</Button>}
                        {asset.status === 'FAILED' && canDelete && <Button type="button" variant="tertiary" disabled={pending} onClick={() => runDelete(asset)}><Trash2 size={15} /> Remove</Button>}
                      </div>
                    </details>
                  </div>
                  <div className="hidden sm:block">
                  <button type="button" className="block w-full text-left transition-opacity hover:opacity-80" onClick={() => toggle(asset.id)} aria-pressed={selectedSet.has(asset.id)}>
                    <AssetPreview asset={asset} />
                    <div className="mt-4 flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-[480]">{displayName}</p>
                      <Badge tone={asset.status === 'READY' ? 'mint' : asset.status === 'FAILED' ? 'coral' : 'cream'}>{MEDIA_STATUS_LABELS[asset.status]}</Badge>
                    </div>
                    <div className="mt-2 hidden flex-wrap gap-2 sm:flex">
                      <Badge tone="outline">{MEDIA_KIND_LABELS[asset.assetKind]}</Badge>
                      {asset.id === createdDerivativeId && <Badge tone="ink">New derivative</Badge>}
                      {asset.usageCount > 0 && <Badge tone="ink">Post attachment</Badge>}
                      {/* Tags were stored and filterable but never shown on the
                          asset, so there was no way to tell what a file carried
                          without opening it. */}
                      {asset.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag.id} tone="lilac">{tag.name}</Badge>
                      ))}
                      {asset.tags.length > 3 && <Badge tone="lilac">+{asset.tags.length - 3}</Badge>}
                    </div>
                    <p className="b88-caption mt-2">{asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}{asset.sizeLabel} · {asset.usageCount} posts</p>
                  </button>
                  {asset.status === 'FAILED' && (
                    <div className="mt-4 border-t border-hairline pt-4">
                      <p className="break-words text-sm font-[480]">This asset could not be prepared. Try processing it again or remove it from the library.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {canEdit && <Button type="button" variant="secondary" disabled={pending} onClick={() => runRetry(asset.id)}>Retry</Button>}
                        {canDelete && <Button type="button" variant="tertiary" disabled={pending} onClick={() => runDelete(asset)}><Trash2 size={15} /> Remove</Button>}
                      </div>
                    </div>
                  )}
                  <div className="absolute right-6 top-6 flex gap-2">
                    <IconButton icon={Eye} label={`Preview ${displayName}`} onClick={() => setPreview(asset)} />
                    <IconButton icon={Download} label={`Download ${displayName}`} onClick={() => downloadAsset(asset)} />
                  </div>
                  </div>
                </article>
              )})}
            </div>
            {visibleAssetCount < assets.length && (
              <Button
                type="button"
                variant="secondary"
                className="mt-6"
                onClick={() => setVisibleAssetCount((count) => Math.min(count + 12, assets.length))}
              >
                Load more
              </Button>
            )}
            </>
          ) : (
            <div className="mt-6">
              <EmptyState eyebrow="No matching assets" title="The library is clear" />
            </div>
          )}
        </main>
      </div>

      {previewAsset && (
        <PreviewDrawer
          asset={previewAsset}
          displayName={assetDisplayName(assets, previewAsset.id)}
          slug={slug}
          tags={tags}
          canEdit={canEdit}
          canDelete={canDelete}
          pending={pending}
          onClose={() => setPreview(null)}
          onDerivative={runDerivative}
          onDetails={runDetails}
          onApplyTag={(tagId, apply) => runApplyTag([previewAsset.id], tagId, apply)}
          onCreateTag={(name) => runCreateTag(name, [previewAsset.id])}
          onRetry={() => runRetry(previewAsset.id, true)}
          onDelete={() => runDelete(previewAsset, true)}
        />
      )}
    </>
  );
}

function downloadAsset(asset: MediaLibraryAsset) {
  const link = document.createElement('a');
  link.href = asset.downloadUrl;
  link.download = asset.filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

// previewUrl is always a still, so the frame renders it as an image even for
// video and audio assets; type only decides the placeholder when there is none.
function AssetPreview({ asset }: { asset: MediaLibraryAsset }) {
  const placeholderType = asset.type === 'IMAGE' || asset.type === 'GIF' ? 'image' : 'video';
  return (
    <MediaFrame
      ratio="1:1"
      tone="mint"
      type={asset.previewUrl ? 'image' : placeholderType}
      src={asset.previewUrl || null}
      alt={asset.altText ?? ''}
      label={MEDIA_TYPE_LABELS[asset.type]}
      showAltWarning={asset.type !== 'AUDIO'}
    />
  );
}

function BulkBar({ ids, assets, folders, tags, canEdit, canDelete, pending, onSubmit, onApplyTag, onCreateTag, onClear }: {
  ids: string[]; assets: MediaLibraryAsset[]; folders: FolderItem[]; tags: TagItem[];
  canEdit: boolean; canDelete: boolean; pending: boolean;
  onSubmit: (data: FormData) => void;
  onApplyTag: (tagId: string, apply: boolean) => void;
  onCreateTag: (name: string) => void;
  onClear: () => void;
}) {
  const [tagsOpen, setTagsOpen] = useState(false);
  // How many of the chosen assets already carry each tag, which is what lets a
  // chip show "3/8" rather than pretending the tag is simply on or off.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const chosen = new Set(ids);
    for (const asset of assets) {
      if (!chosen.has(asset.id)) continue;
      for (const tag of asset.tags) counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1);
    }
    return counts;
  }, [ids, assets]);

  return (
    <form
      action={(data) => {
        const operation = String(data.get('operation'));
        if (operation === 'delete' && !window.confirm(`Delete ${ids.length} selected ${ids.length === 1 ? 'asset' : 'assets'}? Used assets will be kept.`)) return;
        onSubmit(data);
      }}
      className="b88-selection-bar"
      role="region"
      aria-label={`Actions for ${ids.length} selected ${ids.length === 1 ? 'asset' : 'assets'}`}
    >
      {ids.map((id) => <input key={id} type="hidden" name="assetId" value={id} />)}
      <span className="px-2 text-sm font-[480]">{ids.length} selected</span>
      <select className="b88-pill-select" name="folderId" aria-label="Destination folder"><option value="">Root folder</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.label}</option>)}</select>
      <Button name="operation" value="move" type="submit" variant="secondary" disabled={pending}><Move size={15} /> Move</Button>
      <Button name="operation" value="copy" type="submit" variant="secondary" disabled={pending}><Copy size={15} /> Copy</Button>
      {canEdit && (
        <div className="relative">
          <Button
            type="button"
            variant="secondary"
            aria-expanded={tagsOpen}
            onClick={() => setTagsOpen((value) => !value)}
          >
            <Tags size={15} /> Tags
          </Button>
          {tagsOpen && (
            // Above the bar, not below it: the bar is fixed to the bottom of the
            // viewport, so a menu opening downwards would fall off screen.
            <div className="absolute bottom-full right-0 mb-3 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-hairline bg-canvas p-4 text-ink shadow-lg">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="b88-caption">Tags · {ids.length} selected</p>
                <IconButton type="button" icon={X} label="Close tags" onClick={() => setTagsOpen(false)} />
              </div>
              <MediaTagPicker
                tags={tags}
                assetIds={ids}
                tagCounts={tagCounts}
                canCreate
                pending={pending}
                onToggle={onApplyTag}
                onCreate={onCreateTag}
              />
            </div>
          )}
        </div>
      )}
      {canDelete && <Button name="operation" value="delete" type="submit" variant="secondary" disabled={pending}><Trash2 size={15} /> Delete</Button>}
      {/* text-ink is required: the bar sets an inverted text colour the icon would inherit. */}
      <IconButton type="button" icon={X} label="Clear selection" onClick={onClear} className="bg-canvas text-ink" />
    </form>
  );
}

function PreviewDrawer({ asset, displayName, slug, tags, canEdit, canDelete, pending, onClose, onDerivative, onDetails, onApplyTag, onCreateTag, onRetry, onDelete }: {
  asset: MediaLibraryAsset; displayName: string; slug: string; tags: TagItem[];
  canEdit: boolean; canDelete: boolean; pending: boolean;
  onClose: () => void; onDerivative: (id: string, data: FormData) => void;
  onDetails: (id: string, data: FormData) => void;
  onApplyTag: (tagId: string, apply: boolean) => void;
  onCreateTag: (name: string) => void;
  onRetry: () => void; onDelete: () => void;
}) {
  const [preset, setPreset] = useState('');
  const [drafts, setDrafts] = useState<Array<{ id: string; label: string }>>([]);
  const [draftId, setDraftId] = useState('');
  const [draftsLoading, setDraftsLoading] = useState(asset.status === 'READY');
  // One asset, so every count is 1 or absent — the picker's "some" state cannot
  // arise here and each chip reads as a plain on or off.
  const assetTagCounts = useMemo(() => new Map(asset.tags.map((tag) => [tag.id, 1])), [asset.tags]);
  const [draftsError, setDraftsError] = useState('');
  const router = useRouter();
  const dimensions = MEDIA_PRESETS.find((item) => item.id === preset);
  useEffect(() => {
    if (asset.status !== 'READY') return;
    let active = true;
    void listAttachableDraftsAction(slug)
      .then((result) => {
        if (active) setDrafts(result);
      })
      .catch(() => {
        if (active) setDraftsError('Draft destinations are unavailable for this account.');
      })
      .finally(() => {
        if (active) setDraftsLoading(false);
      });
    return () => { active = false; };
  }, [asset.status, slug]);
  return (
    <div className="fixed inset-0 z-50 bg-[var(--scrim-modal)]" onMouseDown={onClose}>
      <aside className="ml-auto flex h-full w-full max-w-xl flex-col bg-canvas" onMouseDown={(event) => event.stopPropagation()}>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4">
          <div><p className="b88-caption">Asset preview</p><h2 className="b88-heading mt-2 break-all">{displayName}</h2></div>
          <button type="button" aria-label="Close preview" className="flex size-10 items-center justify-center rounded-full bg-surface-soft" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="mt-6">
          {asset.type === 'VIDEO'
            ? <VideoPlayer
                src={asset.downloadUrl || null}
                poster={asset.previewUrl || undefined}
                ratio="16:9"
                duration={asset.duration ? formatDuration(asset.duration) : undefined}
                caption={`${displayName} · video preview`}
                errorMessage="This asset could not be played."
              />
            : asset.type === 'AUDIO'
              ? <audio className="w-full" controls preload="metadata" src={asset.downloadUrl} />
              : <AssetPreview asset={asset} />}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone="outline">{MEDIA_KIND_LABELS[asset.assetKind]}</Badge>
          {asset.usageCount > 0 && <Badge tone="ink">Post attachment</Badge>}
          <span className="b88-caption">{MEDIA_TYPE_LABELS[asset.type]} · {asset.sizeLabel}</span>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => downloadAsset(asset)}><Download size={15} /> Download</Button>
          {asset.status === 'READY' && <Button href={`/w/${slug}/compose?asset=${asset.id}`}><Plus size={15} /> Create post</Button>}
          <Button href={`/w/${slug}/studio?source=${asset.id}`} variant="secondary">Open media studio</Button>
        </div>
        {asset.status === 'READY' && (
          <section className="mt-6 rounded-lg border border-hairline p-4" aria-busy={draftsLoading}>
            <p className="b88-caption">Add to an existing draft</p>
            {draftsLoading ? (
              <p className="mt-3 text-sm">Loading draft destinations.</p>
            ) : draftsError ? (
              <StatusMessage tone="error" className="mt-3">{draftsError}</StatusMessage>
            ) : drafts.length ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Select label="Draft destination" value={draftId} onChange={(event) => setDraftId(event.target.value)}>
                  <option value="">Choose a draft</option>
                  {drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.label}</option>)}
                </Select>
                <Button
                  type="button"
                  disabled={!draftId}
                  onClick={() => router.push(`/w/${slug}/compose/${draftId}?asset=${encodeURIComponent(asset.id)}`)}
                >
                  Add to draft
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-sm">There are no editable drafts. Create a post with this asset instead.</p>
            )}
          </section>
        )}

        <section className="mt-8 border-t border-hairline pt-6">
          <p className="b88-caption">Tags</p>
          {canEdit ? (
            <div className="mt-3">
              <MediaTagPicker
                tags={tags}
                assetIds={[asset.id]}
                tagCounts={assetTagCounts}
                canCreate
                pending={pending}
                onToggle={onApplyTag}
                onCreate={onCreateTag}
              />
            </div>
          ) : asset.tags.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {asset.tags.map((tag) => <Badge key={tag.id} tone="lilac">{tag.name}</Badge>)}
            </div>
          ) : (
            <p className="mt-2 text-sm">This asset has no tags.</p>
          )}
        </section>

        <section className="mt-8 border-t border-hairline pt-6">
          <p className="b88-caption">Used in posts</p>
          {asset.usages.length > 0 ? (
            <div className="mt-3 space-y-2">
              {asset.usages.map((usage) => (
                <Link key={usage.id} href={`/w/${slug}/posts/${usage.id}`} className="flex min-h-10 items-center justify-between gap-3 rounded-md bg-surface-soft px-3 text-sm transition-opacity hover:opacity-80">
                  <span className="min-w-0 truncate">{usage.title}</span>
                  <span className="b88-caption shrink-0">{usageStatusLabel(usage.status)} · {humanizeMachineValue(usage.platform)}</span>
                </Link>
              ))}
              <p className="text-sm">Remove or replace this attachment in every post before deleting the library asset. Published posts on external platforms are not changed by library edits.</p>
            </div>
          ) : (
            <p className="mt-2 text-sm">This asset is not attached to a post.</p>
          )}
        </section>

        {asset.status === 'FAILED' && (
          <StatusMessage className="mt-6" tone="error">
            <span className="font-[480]">Processing failed.</span> This asset could not be prepared. Try processing it again or remove it from the library.
            {canEdit && <span className="mt-3 block"><Button type="button" variant="secondary" disabled={pending} onClick={onRetry}>Retry processing</Button></span>}
          </StatusMessage>
        )}

        {canEdit && (
          <>
            <form action={(data) => onDetails(asset.id, data)} className="mt-8">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field name="filename" label="Filename" defaultValue={editableAssetFilename(asset.filename, displayName)} required />
                <Field name="altText" label="Alt text" defaultValue={asset.altText ?? ''} placeholder="Describe the image" />
              </div>
              <Button type="submit" variant="secondary" className="mt-3" disabled={pending}><Pencil size={15} /> Save details</Button>
            </form>

            {asset.type !== 'AUDIO' && (
              <form action={(data) => onDerivative(asset.id, data)} className="mt-8 space-y-4 border-t border-hairline pt-6">
                <div><p className="b88-caption">Editor</p><h3 className="mt-2 text-xl font-[480]">Create a derivative</h3></div>
                <label className="block"><span className="b88-label">Aspect preset</span>
                  <select name="presetId" className="b88-input" value={preset} onChange={(event) => setPreset(event.target.value)}>
                    <option value="">Custom</option>{MEDIA_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <input type="hidden" name="presetLabel" value={dimensions?.label ?? 'Custom'} />
                <div className="grid grid-cols-2 gap-3">
                  <Field name="width" label="Output width" type="number" min="1" value={dimensions?.width ?? undefined} readOnly={Boolean(dimensions)} />
                  <Field name="height" label="Output height" type="number" min="1" value={dimensions?.height ?? undefined} readOnly={Boolean(dimensions)} />
                </div>
                <details>
                  <summary className="cursor-pointer text-sm font-[480]">Crop settings</summary>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field name="cropLeft" label="Left" type="number" min="0" />
                    <Field name="cropTop" label="Top" type="number" min="0" />
                    <Field name="cropWidth" label="Crop width" type="number" min="1" />
                    <Field name="cropHeight" label="Crop height" type="number" min="1" />
                  </div>
                </details>
                {asset.type === 'VIDEO' ? (
                  <div className="grid grid-cols-3 gap-3">
                    <Field name="trimStart" label="Trim start" type="number" min="0" step="0.1" />
                    <Field name="trimEnd" label="Trim end" type="number" min="0" step="0.1" />
                    <Field name="thumbnailOffset" label="Cover offset" type="number" min="0" step="0.1" />
                  </div>
                ) : (
                  <label className="block"><span className="b88-label">Rotate</span>
                    <select name="rotate" className="b88-input"><option value="0">No rotation</option><option value="90">90 degrees</option><option value="180">180 degrees</option><option value="270">270 degrees</option></select>
                  </label>
                )}
                <Button type="submit" disabled={pending}>{pending ? 'Creating' : 'Create derivative'}</Button>
              </form>
            )}
          </>
        )}
        </div>
        {canDelete && (
          <div className="shrink-0 border-t border-hairline bg-canvas p-6">
            <Button type="button" variant="tertiary" disabled={pending || asset.usages.length > 0} onClick={onDelete}>
              <Trash2 size={15} /> {asset.usages.length > 0 ? 'Remove from posts before deleting' : 'Delete asset'}
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * One row of the tag manager: rename in place, or delete.
 *
 * The rename field is only mounted in manage mode. Rendering an input for every
 * tag all the time turned a five-tag sidebar into a column of form controls
 * with no obvious way to simply filter by one.
 */
function TagEditRow({ tag, pending, onRename, onDelete }: {
  tag: TagItem;
  pending: boolean;
  onRename: (data: FormData) => void;
  onDelete: () => void;
}) {
  // Stacked rather than one row: the sidebar is 240px, and a field sharing that
  // width with two 40px circular buttons truncated every name past nine or ten
  // characters — so the manager hid exactly the thing being renamed.
  return (
    <form
      className="rounded-md bg-surface-soft p-2"
      onSubmit={(event) => {
        event.preventDefault();
        onRename(new FormData(event.currentTarget));
      }}
    >
      <input
        name="name"
        className="b88-filter-control w-full"
        style={{ backgroundImage: 'none', paddingRight: 'var(--space-md)' }}
        defaultValue={tag.name}
        aria-label={`Rename ${tag.name}`}
        maxLength={120}
        required
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="b88-caption truncate">
          {tag.assetCount} {tag.assetCount === 1 ? 'asset' : 'assets'}
        </span>
        <span className="flex shrink-0 gap-2">
          <IconButton type="submit" icon={Check} label={`Save ${tag.name}`} disabled={pending} />
          <IconButton
            type="button"
            icon={Trash2}
            label={`Delete ${tag.name}`}
            disabled={pending}
            onClick={onDelete}
          />
        </span>
      </div>
    </form>
  );
}

// A real Link so hover prefetches, but the click is intercepted to run the
// navigation inside a transition and keep the surrounding page mounted.
function FolderLink({
  href,
  active,
  onNavigate,
  children,
}: {
  href: string;
  active: boolean;
  onNavigate: (href: string) => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-10 items-center gap-2 rounded-pill px-3 text-sm transition-opacity hover:opacity-80 ${active ? 'bg-primary text-on-primary' : ''}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onNavigate(href);
      }}
    >
      {children}
    </Link>
  );
}

function FolderSelect({ folders, name, label, defaultValue }: { folders: FolderItem[]; name: string; label: string; defaultValue?: string }) {
  return <select className="b88-input" name={name} defaultValue={defaultValue}><option value="">{label}</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.label}</option>)}</select>;
}

function assetDisplayName(assets: MediaLibraryAsset[], assetId: string) {
  const index = assets.findIndex((asset) => asset.id === assetId);
  const asset = assets[index];
  if (!asset) return 'Media asset';
  const generatedVideo =
    asset.filename.trim().toLowerCase() === 'ai-video-generate.webm';
  const sequence = generatedVideo
    ? assets
        .slice(0, index + 1)
        .filter((item) => item.filename.trim().toLowerCase() === 'ai-video-generate.webm')
        .length
    : undefined;
  return humanizeMachineValue(asset.filename, { sequence });
}

function editableAssetFilename(filename: string, displayName: string) {
  const extension = filename.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '';
  return `${displayName}${extension}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function usageStatusLabel(status: string) {
  return {
    DRAFT: 'Draft',
    REJECTED: 'Rejected',
    PENDING_APPROVAL: 'In review',
    APPROVED: 'Approved',
    SCHEDULED: 'Scheduled',
    PUBLISHING: 'Publishing',
    PUBLISHED: 'Published',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
  }[status] ?? 'Post';
}

/**
 * Flips processing cards to their finished state without a manual refresh.
 *
 * An upload lands as PROCESSING and is completed by a background job that
 * writes the poster frame, dimensions, duration and — for audio — the beat
 * grid. All of that happens after the page rendered, so the library showed
 * "Processing" until somebody reloaded it by hand.
 *
 * The poll asks only for statuses. `router.refresh()` is what actually brings
 * the new data, and it is called on an observed change rather than on a timer:
 * a refresh re-signs every asset URL, so running one every few seconds would
 * make the whole grid re-fetch its images and flicker.
 */
function useProcessingWatch(slug: string, pendingIds: string[], onSettled: () => void) {
  const ids = pendingIds.join(',');
  const settled = useRef(new Map<string, string>());
  const notify = useRef(onSettled);
  notify.current = onSettled;
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    // Reset on every change of the watched set, not only when it empties: a new
    // upload after a stall is a fresh watch and must not inherit the warning.
    setGaveUp(false);
    if (!ids) return;
    let cancelled = false;
    let timer = 0;
    let attempts = 0;

    async function poll() {
      attempts += 1;
      try {
        const response = await fetch(`/api/workspaces/${slug}/media/status?ids=${ids}`);
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { assets: { id: string; status: string }[] };
        // Recorded before refreshing so a refresh that returns stale props —
        // the row was read between the status write and the revalidation —
        // cannot start a refresh loop.
        const finished = body.assets.filter((asset) =>
          asset.status !== 'PROCESSING'
          && asset.status !== 'UPLOADING'
          && settled.current.get(asset.id) !== asset.status);
        if (!finished.length) return;
        for (const asset of finished) settled.current.set(asset.id, asset.status);
        notify.current();
      } catch {
        // A dropped poll is not worth surfacing; the next tick retries.
      }
    }

    // Tight at first, because an image is usually done within a second or two,
    // then relaxed rather than hammering a long video encode at 2s for minutes.
    const tick = async () => {
      await poll();
      if (cancelled) return;
      if (attempts >= MAX_STATUS_POLLS) {
        setGaveUp(true);
        return;
      }
      timer = window.setTimeout(tick, attempts < 10 ? 2000 : 6000);
    };
    timer = window.setTimeout(tick, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ids, slug]);

  return gaveUp;
}
