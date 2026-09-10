'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/guard';
import { mediaKey, storage } from '@/lib/storage';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { audit } from '@/lib/audit';
import { createImageDerivative, createVideoDerivative } from '@/lib/media/process';
import { validateMediaUploads } from '@/lib/media/validation';
import { actionError, actionSuccess, type ActionState } from '@/lib/actions/state';
import { invalid } from '@/lib/errors';

// Callers must read the returned state; upload failures are never thrown.
export async function uploadMediaAction(slug: string, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'media:upload');
    const files = formData.getAll('files').filter((value): value is File => value instanceof File);
    if (!files.length) throw invalid('Choose at least one file.');
    const folderId = nullableString(formData.get('folderId'));
    if (folderId) await requireFolder(ctx.workspace.id, folderId);
    // Validate the whole batch before storing anything. A bad second file must
    // not leave the first file uploaded while the UI reports a failed batch.
    const fileTypes = validateMediaUploads(files);
    for (const [index, file] of files.entries()) {
      const type = fileTypes[index];
      const key = mediaKey(ctx.workspace.id, file.name);
      const bytes = Buffer.from(await file.arrayBuffer());
      await storage().put(key, bytes, file.type);
      const asset = await db.mediaAsset.create({
        data: {
          workspaceId: ctx.workspace.id,
          folderId,
          uploadedById: ctx.user.id,
          filename: file.name,
          mimeType: file.type,
          type,
          size: file.size,
          storageKey: key,
          status: 'PROCESSING',
        },
      });
      await enqueue('process-media', { mediaAssetId: asset.id }, { workspaceId: ctx.workspace.id });
      await audit({
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        action: 'media.uploaded',
        entityType: 'media_asset',
        entityId: asset.id,
        metadata: { filename: file.name, size: file.size },
      });
    }
    revalidatePath(`/w/${slug}/media`);
    return actionSuccess(files.length === 1 ? 'Media uploaded.' : `${files.length} files uploaded.`);
  } catch (error) {
    return actionError(error, 'The media could not be uploaded.');
  }
}

export async function deleteMediaAction(slug: string, mediaId: string) {
  const ctx = await requireWorkspace(slug, 'media:delete');
  const asset = await db.mediaAsset.findFirst({
    where: { id: mediaId, workspaceId: ctx.workspace.id },
    include: {
      postMedia: {
        include: { postPlatform: { select: { post: { select: { title: true, status: true } } } } },
        take: 5,
      },
    },
  });
  if (!asset) throw new Error('Asset not found.');
  if (asset.postMedia.length > 0) {
    const affected = [...new Map(asset.postMedia.map(({ postPlatform }) => [
      postPlatform.post.title || 'Untitled post',
      postPlatform.post.status,
    ])).entries()]
      .map(([title, status]) => `${title} (${status.toLowerCase()})`)
      .join(', ');
    throw new Error(`This asset is attached to ${affected}. Remove or replace it in those posts first.`);
  }
  await Promise.all([
    storage().delete(asset.storageKey),
    asset.thumbnailKey ? storage().delete(asset.thumbnailKey) : Promise.resolve(),
  ]);
  await db.mediaAsset.delete({ where: { id: asset.id } });
  revalidatePath(`/w/${slug}/media`);
  return { message: 'Asset deleted.' };
}

export async function updateMediaDetailsAction(slug: string, mediaId: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'media:update');
  const filename = requiredName(formData.get('filename'), 'filename');
  const altText = nullableString(formData.get('altText'));
  if (altText && altText.length > 1_000) throw new Error('Alt text must be 1,000 characters or fewer.');
  const result = await db.mediaAsset.updateMany({
    where: { id: mediaId, workspaceId: ctx.workspace.id },
    data: { filename, altText },
  });
  if (!result.count) throw new Error('Asset not found.');
  revalidatePath(`/w/${slug}/media`);
  return { message: 'Asset details saved.', filename, altText };
}

export async function retryMediaAction(slug: string, mediaId: string) {
  const ctx = await requireWorkspace(slug, 'media:update');
  const asset = await db.mediaAsset.findFirst({
    where: { id: mediaId, workspaceId: ctx.workspace.id },
    select: { id: true, status: true },
  });
  if (!asset) throw new Error('Asset not found.');
  if (asset.status !== 'FAILED') throw new Error('Only failed assets can be retried.');
  await db.mediaAsset.update({ where: { id: asset.id }, data: { status: 'PROCESSING' } });
  try {
    await enqueue('process-media', { mediaAssetId: asset.id }, {
      workspaceId: ctx.workspace.id,
      dedupeKey: `process-media:${asset.id}`,
    });
  } catch (error) {
    await db.mediaAsset.update({ where: { id: asset.id }, data: { status: 'FAILED' } });
    throw error;
  }
  revalidatePath(`/w/${slug}/media`);
  return { message: 'Processing retry started.' };
}

export async function createFolderAction(slug: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'media:update');
  const parentId = nullableString(formData.get('parentId'));
  if (parentId) await requireFolder(ctx.workspace.id, parentId);
  await db.mediaFolder.create({
    data: { workspaceId: ctx.workspace.id, parentId, name: requiredName(formData.get('name'), 'folder name') },
  });
  revalidatePath(`/w/${slug}/media`);
}

export async function updateFolderAction(slug: string, folderId: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'media:update');
  await requireFolder(ctx.workspace.id, folderId);
  const parentId = nullableString(formData.get('parentId'));
  if (parentId === folderId) throw new Error('A folder cannot contain itself.');
  if (parentId) {
    await requireFolder(ctx.workspace.id, parentId);
    let cursor: string | null = parentId;
    while (cursor) {
      if (cursor === folderId) throw new Error('A folder cannot move into one of its descendants.');
      const row: { parentId: string | null } | null = await db.mediaFolder.findFirst({
        where: { id: cursor, workspaceId: ctx.workspace.id },
        select: { parentId: true },
      });
      cursor = row?.parentId ?? null;
    }
  }
  await db.mediaFolder.update({
    where: { id: folderId },
    data: { name: requiredName(formData.get('name'), 'folder name'), parentId },
  });
  revalidatePath(`/w/${slug}/media`);
}

export async function deleteFolderAction(slug: string, folderId: string) {
  const ctx = await requireWorkspace(slug, 'media:update');
  await requireFolder(ctx.workspace.id, folderId);
  await db.mediaFolder.delete({ where: { id: folderId } });
  revalidatePath(`/w/${slug}/media`);
}

export async function createTagAction(slug: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'media:update');
  await db.mediaTag.create({
    data: { workspaceId: ctx.workspace.id, name: requiredName(formData.get('name'), 'tag name') },
  });
  revalidatePath(`/w/${slug}/media`);
}

export async function renameTagAction(slug: string, tagId: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'media:update');
  await db.mediaTag.updateMany({
    where: { id: tagId, workspaceId: ctx.workspace.id },
    data: { name: requiredName(formData.get('name'), 'tag name') },
  });
  revalidatePath(`/w/${slug}/media`);
}

export async function deleteTagAction(slug: string, tagId: string) {
  const ctx = await requireWorkspace(slug, 'media:update');
  await db.mediaTag.deleteMany({ where: { id: tagId, workspaceId: ctx.workspace.id } });
  revalidatePath(`/w/${slug}/media`);
}

export async function mutateAssetsAction(slug: string, formData: FormData) {
  const operation = String(formData.get('operation'));
  const permission = operation === 'delete' ? 'media:delete' : 'media:update';
  const ctx = await requireWorkspace(slug, permission);
  const ids = [...new Set(formData.getAll('assetId').map(String))].filter(Boolean);
  if (!ids.length) throw new Error('Select at least one asset.');
  const assets = await db.mediaAsset.findMany({ where: { id: { in: ids }, workspaceId: ctx.workspace.id } });
  if (assets.length !== ids.length) throw new Error('One or more assets are unavailable.');

  if (operation === 'move') {
    const folderId = nullableString(formData.get('folderId'));
    if (folderId) await requireFolder(ctx.workspace.id, folderId);
    await db.mediaAsset.updateMany({ where: { id: { in: ids }, workspaceId: ctx.workspace.id }, data: { folderId } });
  } else if (operation === 'tag') {
    const tagId = requiredName(formData.get('tagId'), 'tag');
    const tag = await db.mediaTag.findFirst({ where: { id: tagId, workspaceId: ctx.workspace.id } });
    if (!tag) throw new Error('Tag not found.');
    await db.mediaAssetTag.createMany({
      data: ids.map((mediaAssetId) => ({ mediaAssetId, mediaTagId: tagId })),
      skipDuplicates: true,
    });
  } else if (operation === 'untag') {
    const tagId = requiredName(formData.get('tagId'), 'tag');
    const tag = await db.mediaTag.findFirst({ where: { id: tagId, workspaceId: ctx.workspace.id } });
    if (!tag) throw new Error('Tag not found.');
    await db.mediaAssetTag.deleteMany({ where: { mediaAssetId: { in: ids }, mediaTagId: tagId } });
  } else if (operation === 'copy') {
    const folderId = nullableString(formData.get('folderId'));
    if (folderId) await requireFolder(ctx.workspace.id, folderId);
    for (const asset of assets) {
      const bytes = await storage().get(asset.storageKey);
      const key = mediaKey(ctx.workspace.id, asset.filename, 'derived');
      await storage().put(key, bytes, asset.mimeType);
      const copy = await db.mediaAsset.create({
        data: {
          workspaceId: ctx.workspace.id,
          folderId,
          uploadedById: ctx.user.id,
          filename: copyName(asset.filename),
          mimeType: asset.mimeType,
          type: asset.type,
          size: asset.size,
          width: asset.width,
          height: asset.height,
          duration: asset.duration,
          storageKey: key,
          altText: asset.altText,
          status: 'PROCESSING',
          derivedFromId: asset.id,
          derivationPreset: 'copy',
        },
      });
      await enqueue('process-media', { mediaAssetId: copy.id }, { workspaceId: ctx.workspace.id });
    }
  } else if (operation === 'delete') {
    const used = await db.postMedia.findFirst({
      where: { mediaAssetId: { in: ids }, mediaAsset: { workspaceId: ctx.workspace.id } },
      select: { mediaAsset: { select: { filename: true } } },
    });
    if (used) throw new Error(`${used.mediaAsset.filename} is attached to a post. Remove or replace it there first.`);
    await Promise.all(assets.flatMap((asset) => [
      storage().delete(asset.storageKey),
      asset.thumbnailKey ? storage().delete(asset.thumbnailKey) : Promise.resolve(),
    ]));
    await db.mediaAsset.deleteMany({ where: { id: { in: ids }, workspaceId: ctx.workspace.id } });
  } else {
    throw new Error('Unknown media operation.');
  }
  revalidatePath(`/w/${slug}/media`);
  const count = assets.length;
  const noun = count === 1 ? 'asset' : 'assets';
  const messages: Record<string, string> = {
    move: `${count} ${noun} moved.`,
    copy: `${count} ${noun} copied. Processing runs in the background.`,
    tag: `${count} ${noun} tagged.`,
    untag: `Tag removed from ${count} ${noun}.`,
    delete: `${count} ${noun} deleted.`,
  };
  return { message: messages[operation] };
}

export async function createDerivativeAction(slug: string, mediaId: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'media:update');
  const source = await db.mediaAsset.findFirst({ where: { id: mediaId, workspaceId: ctx.workspace.id } });
  if (!source) throw new Error('Asset not found.');
  const presetId = nullableString(formData.get('presetId'));
  const presetLabel = nullableString(formData.get('presetLabel'));
  const resize = optionalBox(formData, 'width', 'height');
  const crop = optionalCrop(formData);
  let derivativeId: string;
  let message = 'Derivative created. Processing runs in the background.';

  if (source.type === 'VIDEO') {
    const result = await createVideoDerivative({
      sourceAssetId: source.id,
      userId: ctx.user.id,
      presetId: presetId ?? undefined,
      presetLabel: presetLabel ?? undefined,
      edit: {
        resize,
        crop,
        trimStart: optionalNumber(formData.get('trimStart')),
        trimEnd: optionalNumber(formData.get('trimEnd')),
        thumbnailOffset: optionalNumber(formData.get('thumbnailOffset')),
      },
    });
    derivativeId = result.id;
    if (!result.rendered) message = 'ffmpeg is unavailable. Edit settings were saved on a copied derivative for later rendering.';
  } else if (source.type === 'IMAGE' || source.type === 'GIF') {
    derivativeId = await createImageDerivative({
      sourceAssetId: source.id,
      userId: ctx.user.id,
      presetId: presetId ?? undefined,
      presetLabel: presetLabel ?? undefined,
      resize,
      crop,
      rotate: optionalNumber(formData.get('rotate')),
    });
  } else {
    throw new Error('Audio assets cannot be edited here.');
  }
  await enqueue('process-media', { mediaAssetId: derivativeId }, { workspaceId: ctx.workspace.id });
  revalidatePath(`/w/${slug}/media`);
  return { message, derivativeId };
}

async function requireFolder(workspaceId: string, id: string) {
  const folder = await db.mediaFolder.findFirst({ where: { id, workspaceId } });
  if (!folder) throw new Error('Folder not found.');
  return folder;
}

function requiredName(value: FormDataEntryValue | null, label: string) {
  const result = String(value ?? '').trim();
  if (!result || result.length > 120) throw new Error(`Enter a valid ${label}.`);
  return result;
}

function nullableString(value: FormDataEntryValue | null) {
  const result = String(value ?? '').trim();
  return result || null;
}

function optionalNumber(value: FormDataEntryValue | null) {
  if (value === null || String(value).trim() === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('Editor values must be positive numbers.');
  return number;
}

function optionalBox(formData: FormData, widthKey: string, heightKey: string) {
  const width = optionalNumber(formData.get(widthKey));
  const height = optionalNumber(formData.get(heightKey));
  if (width === undefined && height === undefined) return undefined;
  if (!width || !height) throw new Error('Width and height are both required.');
  return { width: Math.round(width), height: Math.round(height) };
}

function optionalCrop(formData: FormData) {
  const width = optionalNumber(formData.get('cropWidth'));
  const height = optionalNumber(formData.get('cropHeight'));
  const left = optionalNumber(formData.get('cropLeft'));
  const top = optionalNumber(formData.get('cropTop'));
  if ([width, height, left, top].every((value) => value === undefined)) return undefined;
  if (!width || !height || left === undefined || top === undefined) throw new Error('Complete all crop fields.');
  return { width: Math.round(width), height: Math.round(height), left: Math.round(left), top: Math.round(top) };
}

function copyName(filename: string) {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? `${filename.slice(0, dot)} copy${filename.slice(dot)}` : `${filename} copy`;
}
