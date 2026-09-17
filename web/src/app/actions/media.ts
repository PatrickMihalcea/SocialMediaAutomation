'use server';

import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/guard';
import { mediaKey, storage } from '@/lib/storage';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { createImageDerivative, createVideoDerivative } from '@/lib/media/process';
import { actionError, actionSuccess, type ActionState } from '@/lib/actions/state';
import { storeMediaUpload } from '@/lib/media/upload';
import { parseAudioStart } from '@/lib/media/audio-start';

// Callers must read the returned state; upload failures are never thrown.
export async function uploadMediaAction(slug: string, formData: FormData): Promise<ActionState> {
  try {
    const { count } = await storeMediaUpload(slug, formData);
    return actionSuccess(count === 1 ? 'Media uploaded.' : `${count} files uploaded.`);
  } catch (error) {
    return actionError(error, 'The media could not be uploaded.');
  }
}

/**
 * Deleting media that a post is using.
 *
 * Refusing outright was a dead end: the only way forward was to open every post
 * and detach the asset by hand, and the message did not even say which posts.
 * So the caller says what it wants done with them instead.
 *
 * Published posts are the exception and stay refused. Their media is already on
 * the platform and the row here is the record of what went out — deleting it
 * would leave a post nobody can reconstruct, which is not a thing to offer
 * behind a confirm dialog.
 */
export async function deleteMediaAction(
  slug: string,
  mediaId: string,
  mode: 'refuse' | 'detach' | 'delete-posts' = 'refuse',
) {
  const ctx = await requireWorkspace(slug, 'media:delete');
  const asset = await db.mediaAsset.findFirst({
    where: { id: mediaId, workspaceId: ctx.workspace.id },
    include: {
      postMedia: {
        include: { postPlatform: { select: { postId: true, post: { select: { title: true, status: true } } } } },
      },
    },
  });
  if (!asset) throw new Error('Asset not found.');

  const published = asset.postMedia.filter(({ postPlatform }) =>
    ['PUBLISHED', 'PUBLISHING'].includes(postPlatform.post.status),
  );
  if (published.length > 0) {
    const titles = [...new Set(published.map(({ postPlatform }) => postPlatform.post.title || 'Untitled post'))];
    throw new Error(
      `${titles.join(', ')} ${titles.length === 1 ? 'has' : 'have'} already been published with this asset, so it cannot be deleted. It is the record of what went out.`,
    );
  }

  if (asset.postMedia.length > 0) {
    if (mode === 'refuse') {
      // Answered, not thrown. The browser's copy of what uses this asset is as
      // old as its last render — attach it to a draft in another tab and the
      // page still believes it is unused — so the question of whether anything
      // is using it is settled here, where the answer is current.
      return {
        status: 'in-use' as const,
        posts: [...new Map(asset.postMedia.map(({ postPlatform }) => [
          postPlatform.postId,
          {
            id: postPlatform.postId,
            title: postPlatform.post.title || 'Untitled post',
            status: postPlatform.post.status as string,
          },
        ])).values()],
      };
    }
    if (mode === 'delete-posts') {
      const postIds = [...new Set(asset.postMedia.map(({ postPlatform }) => postPlatform.postId))];
      await db.post.deleteMany({ where: { id: { in: postIds }, workspaceId: ctx.workspace.id } });
    } else {
      // Detach only. The posts survive with one fewer attachment, which is what
      // someone means by "take it out of the drafts".
      await db.postMedia.deleteMany({ where: { mediaAssetId: asset.id } });
    }
  }

  await Promise.all([
    storage().delete(asset.storageKey),
    asset.thumbnailKey ? storage().delete(asset.thumbnailKey) : Promise.resolve(),
  ]);
  await db.mediaAsset.delete({ where: { id: asset.id } });
  revalidatePath(`/w/${slug}/media`);
  revalidatePath(`/w/${slug}/drafts`);
  return {
    status: 'deleted' as const,
    message:
      asset.postMedia.length === 0
        ? 'Asset deleted.'
        : mode === 'delete-posts'
          ? 'Asset and the posts using it were deleted.'
          : 'Asset deleted and removed from the posts using it.',
  };
}

export async function updateMediaDetailsAction(slug: string, mediaId: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'media:update');
  const filename = requiredName(formData.get('filename'), 'filename');
  const altText = nullableString(formData.get('altText'));
  if (altText && altText.length > 1_000) throw new Error('Alt text must be 1,000 characters or fewer.');

  // Read first, for the track length the start point is validated against —
  // and because only audio carries one at all.
  const asset = await db.mediaAsset.findFirst({
    where: { id: mediaId, workspaceId: ctx.workspace.id },
    select: { type: true, duration: true },
  });
  if (!asset) throw new Error('Asset not found.');

  const isAudio = asset.type === 'AUDIO';
  // The field is absent from the form for everything but audio. Absent means
  // "not editable here" and must leave the stored value alone, which is why
  // this is undefined rather than null — Prisma skips an undefined field.
  const audioStart = isAudio && formData.has('audioStart')
    ? parseAudioStart(formData.get('audioStart'), { duration: asset.duration })
    : undefined;

  const result = await db.mediaAsset.updateMany({
    where: { id: mediaId, workspaceId: ctx.workspace.id },
    data: { filename, altText, ...(audioStart === undefined ? {} : { audioStart }) },
  });
  if (!result.count) throw new Error('Asset not found.');
  revalidatePath(`/w/${slug}/media`);
  // The composer reads this asset's default when a track is attached, so a
  // change here has to reach a composer that is already open.
  if (isAudio) revalidatePath(`/w/${slug}/compose`);
  return { message: 'Asset details saved.', filename, altText, audioStart };
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

/**
 * Creates a tag, or returns the one that already carries that name.
 *
 * The tag is returned so the picker can create and apply in a single gesture.
 * A repeated name is not an error here: typing a name that exists into the
 * "new tag" field means "use that one", and failing on the unique constraint
 * would only ask the user to go and find it in the list instead.
 */
export async function createTagAction(slug: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'media:update');
  const name = requiredName(formData.get('name'), 'tag name');
  const tag = await db.mediaTag.upsert({
    where: { workspaceId_name: { workspaceId: ctx.workspace.id, name } },
    update: {},
    create: { workspaceId: ctx.workspace.id, name },
  });
  revalidatePath(`/w/${slug}/media`);
  return { id: tag.id, name: tag.name };
}

/**
 * Adds or removes one tag across a set of assets.
 *
 * Split out of mutateAssetsAction so a single asset can be tagged from its own
 * preview. Tagging used to run only through the selection bar, which meant
 * tagging one file started by selecting it.
 */
export async function applyTagAction(
  slug: string,
  input: { assetIds: string[]; tagId: string; apply: boolean },
) {
  const ctx = await requireWorkspace(slug, 'media:update');
  const ids = [...new Set(input.assetIds)].filter(Boolean);
  if (!ids.length) throw new Error('Select at least one asset.');
  const tag = await db.mediaTag.findFirst({
    where: { id: input.tagId, workspaceId: ctx.workspace.id },
  });
  if (!tag) throw new Error('Tag not found.');
  // Scoped by workspace, so a foreign id cannot be tagged through this action.
  const owned = await db.mediaAsset.findMany({
    where: { id: { in: ids }, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  if (owned.length !== ids.length) throw new Error('One or more assets are unavailable.');

  if (input.apply) {
    await db.mediaAssetTag.createMany({
      data: ids.map((mediaAssetId) => ({ mediaAssetId, mediaTagId: tag.id })),
      skipDuplicates: true,
    });
  } else {
    await db.mediaAssetTag.deleteMany({ where: { mediaAssetId: { in: ids }, mediaTagId: tag.id } });
  }
  revalidatePath(`/w/${slug}/media`);
  const noun = ids.length === 1 ? 'asset' : 'assets';
  return {
    tag: { id: tag.id, name: tag.name },
    message: input.apply
      ? `${tag.name} added to ${ids.length} ${noun}.`
      : `${tag.name} removed from ${ids.length} ${noun}.`,
  };
}

export async function renameTagAction(slug: string, tagId: string, formData: FormData) {
  const ctx = await requireWorkspace(slug, 'media:update');
  const name = requiredName(formData.get('name'), 'tag name');
  const clash = await db.mediaTag.findFirst({
    where: { workspaceId: ctx.workspace.id, name, NOT: { id: tagId } },
    select: { id: true },
  });
  if (clash) throw new Error(`A tag named ${name} already exists.`);
  const result = await db.mediaTag.updateMany({
    where: { id: tagId, workspaceId: ctx.workspace.id },
    data: { name },
  });
  if (!result.count) throw new Error('Tag not found.');
  revalidatePath(`/w/${slug}/media`);
  return { id: tagId, name, message: `Tag renamed to ${name}.` };
}

export async function deleteTagAction(slug: string, tagId: string) {
  const ctx = await requireWorkspace(slug, 'media:update');
  const result = await db.mediaTag.deleteMany({ where: { id: tagId, workspaceId: ctx.workspace.id } });
  if (!result.count) throw new Error('Tag not found.');
  revalidatePath(`/w/${slug}/media`);
  return { message: 'Tag deleted.' };
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
    // The same three answers the single-asset delete gives. This path had its
    // own guard that only threw, so selecting one asset and pressing Delete in
    // the selection bar refused where the identical action on the card offered
    // a way forward — two behaviours for one verb.
    const mode = deleteMode(formData.get('mode'));
    const attached = await db.postMedia.findMany({
      where: { mediaAssetId: { in: ids }, mediaAsset: { workspaceId: ctx.workspace.id } },
      select: { postPlatform: { select: { postId: true, post: { select: { title: true, status: true } } } } },
    });

    const published = attached.filter(({ postPlatform }) =>
      ['PUBLISHED', 'PUBLISHING'].includes(postPlatform.post.status),
    );
    if (published.length > 0) {
      const titles = [...new Set(published.map(({ postPlatform }) => postPlatform.post.title || 'Untitled post'))];
      throw new Error(
        `${titles.join(', ')} ${titles.length === 1 ? 'has' : 'have'} already been published with this media, so it cannot be deleted. It is the record of what went out.`,
      );
    }

    if (attached.length > 0) {
      if (mode === 'refuse') {
        return {
          status: 'in-use' as const,
          posts: [...new Map(attached.map(({ postPlatform }) => [
            postPlatform.postId,
            {
              id: postPlatform.postId,
              title: postPlatform.post.title || 'Untitled post',
              status: postPlatform.post.status as string,
            },
          ])).values()],
        };
      }
      if (mode === 'delete-posts') {
        const postIds = [...new Set(attached.map(({ postPlatform }) => postPlatform.postId))];
        await db.post.deleteMany({ where: { id: { in: postIds }, workspaceId: ctx.workspace.id } });
      } else {
        await db.postMedia.deleteMany({ where: { mediaAssetId: { in: ids } } });
      }
    }

    await Promise.all(assets.flatMap((asset) => [
      storage().delete(asset.storageKey),
      asset.thumbnailKey ? storage().delete(asset.thumbnailKey) : Promise.resolve(),
    ]));
    await db.mediaAsset.deleteMany({ where: { id: { in: ids }, workspaceId: ctx.workspace.id } });
    revalidatePath(`/w/${slug}/drafts`);
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
  return { status: 'done' as const, message: messages[operation] };
}

/** Only the three the UI can ask for; anything else is treated as a question. */
function deleteMode(value: FormDataEntryValue | null): 'refuse' | 'detach' | 'delete-posts' {
  const mode = String(value ?? '');
  return mode === 'detach' || mode === 'delete-posts' ? mode : 'refuse';
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
