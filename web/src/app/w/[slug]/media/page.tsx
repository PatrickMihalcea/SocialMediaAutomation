import { Suspense } from 'react';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { formatBytes } from '@/lib/social/base';
import { MediaPagePreview } from '@/components/page-previews';
import { MediaFilters } from '@/components/media-filters';
import { MediaLibrary } from '@/components/media-library';
import { classifyMediaAsset, GENERATED_MEDIA_PRESETS } from '@/lib/media/classification';

export const metadata = { title: 'Media' };

export default function MediaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; type?: string; tag?: string; folder?: string; filter?: string; sort?: string }>;
}) {
  return (
    <>
      <div><p className="b88-eyebrow">Library</p><h1 className="b88-page-title mt-3">Media</h1></div>
      <Suspense fallback={<MediaPagePreview />}>
        <MediaData params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function MediaData({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; type?: string; tag?: string; folder?: string; filter?: string; sort?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await requireWorkspace(slug, 'media:view');
  const type = ['IMAGE', 'VIDEO', 'GIF', 'AUDIO'].includes(query.type ?? '') ? query.type as 'IMAGE' | 'VIDEO' | 'GIF' | 'AUDIO' : undefined;
  const [rows, folders, tags, failedJobs] = await Promise.all([
    db.mediaAsset.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        folderId: query.folder || undefined,
        type,
        tags: query.tag ? { some: { mediaTagId: query.tag } } : undefined,
        ...(query.filter === 'uploaded' ? { aiGenerationId: null, derivedFromId: null, derivationPreset: null } : {}),
        postMedia: query.filter === 'used'
          ? { some: {} }
          : query.filter === 'unused'
            ? { none: {} }
            : undefined,
        AND: [
          ...(query.q ? [{
            OR: [
              { filename: { contains: query.q, mode: 'insensitive' as const } },
              { tags: { some: { mediaTag: { name: { contains: query.q, mode: 'insensitive' as const } } } } },
              { folder: { name: { contains: query.q, mode: 'insensitive' as const } } },
            ],
          }] : []),
          ...(query.filter === 'generated' ? [{
            OR: [
              { aiGenerationId: { not: null } },
              { derivationPreset: { in: [...GENERATED_MEDIA_PRESETS] } },
            ],
          }] : []),
        ],
      },
      orderBy: query.sort === 'name'
        ? { filename: 'asc' }
        : query.sort === 'oldest'
          ? { createdAt: 'asc' }
          : query.sort === 'size'
            ? { size: 'desc' }
            : query.sort === 'usage'
              ? { usageCount: 'desc' }
            : { createdAt: 'desc' },
      include: {
        tags: { include: { mediaTag: true } },
        postMedia: {
          orderBy: { createdAt: 'desc' },
          include: {
            postPlatform: {
              select: {
                platform: true,
                post: { select: { id: true, title: true, status: true } },
              },
            },
          },
        },
      },
    }),
    db.mediaFolder.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: { name: 'asc' } }),
    db.mediaTag.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { name: 'asc' },
      // Counted so the sidebar can say how much each tag actually holds; a tag
      // list without them gives no clue which ones are in use.
      include: { _count: { select: { assets: true } } },
    }),
    db.job.findMany({
      where: { workspaceId: ctx.workspace.id, type: 'process-media', status: 'FAILED' },
      orderBy: { completedAt: 'desc' },
      take: 200,
      select: { payload: true, error: true },
    }),
  ]);
  const processingErrors = new Map<string, string>();
  for (const job of failedJobs) {
    const payload = job.payload as { mediaAssetId?: unknown };
    const mediaAssetId = typeof payload.mediaAssetId === 'string' ? payload.mediaAssetId : null;
    if (mediaAssetId && job.error && !processingErrors.has(mediaAssetId)) {
      processingErrors.set(mediaAssetId, job.error);
    }
  }
  const assets = await Promise.all(
    rows.map(async (asset) => ({
      id: asset.id,
      filename: asset.filename,
      mimeType: asset.mimeType,
      type: asset.type,
      status: asset.status,
      sizeLabel: formatBytes(asset.size),
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      usageCount: asset.usageCount,
      folderId: asset.folderId,
      altText: asset.altText,
      derivedFromId: asset.derivedFromId,
      derivationPreset: asset.derivationPreset,
      assetKind: classifyMediaAsset(asset),
      usages: [...new Map(asset.postMedia.map(({ postPlatform }) => [
        postPlatform.post.id,
        {
          id: postPlatform.post.id,
          title: postPlatform.post.title || 'Untitled post',
          status: postPlatform.post.status,
          platform: postPlatform.platform,
        },
      ])).values()],
      errorMessage: asset.status === 'FAILED'
        ? processingErrors.get(asset.id) ?? 'Processing stopped before the asset could be prepared.'
        : null,
      previewUrl: asset.thumbnailKey || asset.type === 'IMAGE' || asset.type === 'GIF'
        ? await storage().signedUrl(asset.thumbnailKey ?? asset.storageKey)
        : '',
      downloadUrl: await storage().signedUrl(asset.storageKey),
      tags: asset.tags.map(({ mediaTag }) => ({ id: mediaTag.id, name: mediaTag.name })),
    })),
  );
  const folderItems = folders.map((folder) => ({
    ...folder,
    label: folderLabel(folder.id, folders),
  }));
  const tagItems = tags.map((tag) => ({ id: tag.id, name: tag.name, assetCount: tag._count.assets }));

  return (
    <div className="flow-root min-h-[680px]">
      <MediaFilters slug={slug} current={query} />
      <MediaLibrary
        slug={slug}
        assets={assets}
        folders={folderItems}
        tags={tagItems}
        canEdit={ctx.can('media:update') && ctx.can('media:upload')}
        canDelete={ctx.can('media:delete')}
        currentFolder={query.folder ?? null}
      />
    </div>
  );
}

function folderLabel(id: string, folders: { id: string; parentId: string | null; name: string }[]) {
  const names: string[] = [];
  const seen = new Set<string>();
  let current = folders.find((folder) => folder.id === id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? folders.find((folder) => folder.id === current?.parentId) : undefined;
  }
  return names.join(' / ');
}
