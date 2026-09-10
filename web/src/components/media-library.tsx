'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Copy, Download, Eye, Folder, Move, Pencil, Plus,
  Tags, Trash2, X,
} from 'lucide-react';
import { Badge, Button, EmptyState, Field, IconButton, MediaFrame, MediaUploader, Select, StatusMessage, VideoPlayer } from '@/bridge88/components';
import { listAttachableDraftsAction } from '@/app/actions/posts';
import { MEDIA_PRESETS } from '@/lib/social/capabilities';
import {
  createDerivativeAction, createFolderAction, createTagAction, deleteFolderAction,
  deleteMediaAction, deleteTagAction, mutateAssetsAction,
  renameTagAction, retryMediaAction, updateFolderAction, updateMediaDetailsAction,
  uploadMediaAction,
} from '@/app/actions/media';

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

interface FolderItem { id: string; parentId: string | null; name: string; label: string }
interface TagItem { id: string; name: string }

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
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  // Folder changes run as a transition so only the asset grid dims; a plain
  // <a href> reloaded the document and flashed the full-page loading screen.
  const [navigating, startNavigation] = useTransition();
  const router = useRouter();
  const navigate = (href: string) => startNavigation(() => router.push(href));
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
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
  // uploadMediaAction reports failures in its returned state rather than throwing.
  const runUpload = (data: FormData) => {
    setUploading(true);
    startTransition(async () => {
      try {
        const result = await uploadMediaAction(slug, data);
        setNotice(result.error
          ? { tone: 'error', message: result.error }
          : { tone: 'success', message: result.success ?? 'Media uploaded.' });
        if (!result.error) {
          clearStagedFiles();
          router.refresh();
        }
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
    if (asset.usages.length > 0) {
      setNotice({
        tone: 'error',
        message: `${asset.filename} is attached to ${asset.usages.length} ${asset.usages.length === 1 ? 'post' : 'posts'}. Open the asset preview to review them before removing media from those posts.`,
      });
      return;
    }
    if (!window.confirm(`Delete ${asset.filename}? This cannot be undone.`)) return;
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

  return (
    <>
      {notice && <StatusMessage className="mt-6" tone={notice.tone}>{notice.message}</StatusMessage>}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <section className="b88-card p-4">
            <p className="b88-caption">Folders</p>
            <nav className="mt-3 space-y-1">
              <FolderLink href={`/w/${slug}/media`} active={!currentFolder} onNavigate={navigate}>
                <Folder size={16} className="shrink-0" /> All media
              </FolderLink>
              {folders.map((folder) => (
                <FolderLink
                  key={folder.id}
                  href={`/w/${slug}/media?folder=${folder.id}`}
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

          <section className="b88-card p-4">
            <p className="b88-caption">Tags</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {tags.map((tag) => <Badge key={tag.id} tone="outline">{tag.name}</Badge>)}
            </div>
            {canEdit && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-[480]">Manage tags</summary>
                <form action={createTagAction.bind(null, slug)} className="mt-3 flex gap-2">
                  <input name="name" className="b88-filter-control min-w-0 flex-1" placeholder="Tag name" required />
                  <Button type="submit" variant="secondary">Add</Button>
                </form>
                {tags.map((tag) => (
                  <div key={tag.id} className="mt-2 flex gap-2">
                    <form action={renameTagAction.bind(null, slug, tag.id)} className="flex min-w-0 flex-1 gap-2">
                      <input name="name" className="b88-filter-control min-w-0 flex-1" defaultValue={tag.name} required />
                      <Button type="submit" variant="tertiary">Save</Button>
                    </form>
                    <form
                      action={deleteTagAction.bind(null, slug, tag.id)}
                      onSubmit={(event) => {
                        if (!window.confirm(`Delete tag ${tag.name}? Assets will be retained.`)) event.preventDefault();
                      }}
                    >
                      <IconButton type="submit" icon={Trash2} label={`Delete tag ${tag.name}`} />
                    </form>
                  </div>
                ))}
              </details>
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
                    <p className="font-[480]">{queuedFiles.length === 1 ? queuedFiles[0].name : `${queuedFiles.length} files selected`}</p>
                    <p className="b88-caption mt-1">
                      {uploading
                        ? 'Uploading now. Active uploads cannot be canceled; keep this page open until the upload finishes.'
                        : 'Review the selection before upload.'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!uploading && <Button type="button" variant="tertiary" onClick={clearStagedFiles}>Cancel</Button>}
                    <Button type="submit" disabled={uploading}>{uploading ? 'Uploading' : 'Upload'}</Button>
                  </div>
                </div>
              )}
            </form>
          )}

          {selected.length > 0 && (
            <BulkBar ids={selected} folders={folders} tags={tags} canDelete={canDelete} pending={pending} onSubmit={runBulkAction} onClear={() => setSelected([])} />
          )}

          {assets.length ? (
            // pb-28 keeps the floating selection bar from covering the last row.
            <div className={`mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 ${selected.length ? 'pb-28' : ''}`}>
              {assets.map((asset) => (
                <article
                  key={asset.id}
                  ref={(element) => {
                    if (element && asset.id === createdDerivativeId) {
                      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }}
                  className={`b88-card relative overflow-hidden p-4 ${selectedSet.has(asset.id) || asset.id === createdDerivativeId ? 'border-ink bg-surface-soft' : ''}`}
                >
                  <button type="button" className="block w-full text-left transition-opacity hover:opacity-80" onClick={() => toggle(asset.id)} aria-pressed={selectedSet.has(asset.id)}>
                    <AssetPreview asset={asset} />
                    <div className="mt-4 flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-[480]">{asset.filename}</p>
                      <Badge tone={asset.status === 'READY' ? 'mint' : asset.status === 'FAILED' ? 'coral' : 'cream'}>{asset.status.toLowerCase()}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone="outline">{asset.assetKind.toLowerCase()}</Badge>
                      {asset.id === createdDerivativeId && <Badge tone="ink">New derivative</Badge>}
                      {asset.usageCount > 0 && <Badge tone="ink">Post attachment</Badge>}
                    </div>
                    <p className="b88-caption mt-2">{asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}{asset.sizeLabel} · {asset.usageCount} posts</p>
                  </button>
                  {asset.status === 'FAILED' && (
                    <div className="mt-4 border-t border-hairline pt-4">
                      <p className="break-words text-sm font-[480]">{asset.errorMessage}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {canEdit && <Button type="button" variant="secondary" disabled={pending} onClick={() => runRetry(asset.id)}>Retry</Button>}
                        {canDelete && <Button type="button" variant="tertiary" disabled={pending} onClick={() => runDelete(asset)}><Trash2 size={15} /> Remove</Button>}
                      </div>
                    </div>
                  )}
                  <div className="absolute right-6 top-6 flex gap-2">
                    <IconButton icon={Eye} label={`Preview ${asset.filename}`} onClick={() => setPreview(asset)} />
                    <IconButton icon={Download} label={`Download ${asset.filename}`} onClick={() => downloadAsset(asset)} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-6">
              <EmptyState eyebrow="No matching assets" title="The library is clear">
                Upload files above, or pick another folder to see what is already stored.
              </EmptyState>
            </div>
          )}
        </main>
      </div>

      {preview && (
        <PreviewDrawer
          asset={preview}
          slug={slug}
          canEdit={canEdit}
          canDelete={canDelete}
          pending={pending}
          onClose={() => setPreview(null)}
          onDerivative={runDerivative}
          onDetails={runDetails}
          onRetry={() => runRetry(preview.id, true)}
          onDelete={() => runDelete(preview, true)}
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
      label={asset.type.toLowerCase()}
      showAltWarning={asset.type !== 'AUDIO'}
    />
  );
}

function BulkBar({ ids, folders, tags, canDelete, pending, onSubmit, onClear }: {
  ids: string[]; folders: FolderItem[]; tags: TagItem[]; canDelete: boolean; pending: boolean;
  onSubmit: (data: FormData) => void; onClear: () => void;
}) {
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
      <select className="b88-pill-select" name="tagId" aria-label="Tag to apply"><option value="">Choose tag</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>
      <Button name="operation" value="tag" type="submit" variant="secondary" disabled={pending}><Tags size={15} /> Tag</Button>
      <Button name="operation" value="untag" type="submit" variant="secondary" disabled={pending}>Remove tag</Button>
      {canDelete && <Button name="operation" value="delete" type="submit" variant="secondary" disabled={pending}><Trash2 size={15} /> Delete</Button>}
      {/* text-ink is required: the bar sets an inverted text colour the icon would inherit. */}
      <IconButton type="button" icon={X} label="Clear selection" onClick={onClear} className="bg-canvas text-ink" />
    </form>
  );
}

function PreviewDrawer({ asset, slug, canEdit, canDelete, pending, onClose, onDerivative, onDetails, onRetry, onDelete }: {
  asset: MediaLibraryAsset; slug: string; canEdit: boolean; canDelete: boolean; pending: boolean;
  onClose: () => void; onDerivative: (id: string, data: FormData) => void;
  onDetails: (id: string, data: FormData) => void; onRetry: () => void; onDelete: () => void;
}) {
  const [preset, setPreset] = useState('');
  const [drafts, setDrafts] = useState<Array<{ id: string; label: string }>>([]);
  const [draftId, setDraftId] = useState('');
  const [draftsLoading, setDraftsLoading] = useState(asset.status === 'READY');
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
          <div><p className="b88-caption">Asset preview</p><h2 className="b88-heading mt-2 break-all">{asset.filename}</h2></div>
          <button type="button" aria-label="Close preview" className="flex size-10 items-center justify-center rounded-full bg-surface-soft" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="mt-6">
          {asset.type === 'VIDEO'
            ? <VideoPlayer
                src={asset.downloadUrl || null}
                poster={asset.previewUrl || undefined}
                ratio="16:9"
                duration={asset.duration ? formatDuration(asset.duration) : undefined}
                caption={`${asset.filename} · video preview`}
                errorMessage="This asset could not be played."
              />
            : asset.type === 'AUDIO'
              ? <audio className="w-full" controls preload="metadata" src={asset.downloadUrl} />
              : <AssetPreview asset={asset} />}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone="outline">{asset.assetKind}</Badge>
          {asset.usageCount > 0 && <Badge tone="ink">Post attachment</Badge>}
          <span className="b88-caption">{asset.mimeType} · {asset.sizeLabel}</span>
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
          <p className="b88-caption">Used in posts</p>
          {asset.usages.length > 0 ? (
            <div className="mt-3 space-y-2">
              {asset.usages.map((usage) => (
                <Link key={usage.id} href={`/w/${slug}/posts/${usage.id}`} className="flex min-h-10 items-center justify-between gap-3 rounded-md bg-surface-soft px-3 text-sm transition-opacity hover:opacity-80">
                  <span className="min-w-0 truncate">{usage.title}</span>
                  <span className="b88-caption shrink-0">{usage.status.toLowerCase()} · {usage.platform.toLowerCase()}</span>
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
            <span className="font-[480]">Processing failed.</span> {asset.errorMessage}
            {canEdit && <span className="mt-3 block"><Button type="button" variant="secondary" disabled={pending} onClick={onRetry}>Retry processing</Button></span>}
          </StatusMessage>
        )}

        {canEdit && (
          <>
            <form action={(data) => onDetails(asset.id, data)} className="mt-8">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field name="filename" label="Filename" defaultValue={asset.filename} required />
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

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
