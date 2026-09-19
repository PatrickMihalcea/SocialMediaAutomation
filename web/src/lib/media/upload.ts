import 'server-only';
import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { invalid } from '@/lib/errors';
import { enqueue } from '@/lib/queue';
import { mediaKey, storage } from '@/lib/storage';
import { validateMediaUploads } from '@/lib/media/validation';
import {
  assertStorageUploadWithinPlan,
  newUploadBytes,
  uploadAssetId,
} from '@/lib/media/upload-idempotency';
import { workspacePlan } from '@/lib/billing/limits';

/**
 * Stores an uploaded batch.
 *
 * Lives here rather than in the server action because Next caps a Server Action
 * request body at 1 MB, while this app advertises 250 MB per file — so the
 * request died long before any of this validation ran. A route handler calls
 * this instead; the action remains for callers that are already under the cap.
 */
async function requireFolder(workspaceId: string, id: string) {
  const folder = await db.mediaFolder.findFirst({ where: { id, workspaceId } });
  if (!folder) throw invalid('That folder no longer exists.');
  return folder;
}

const nullableString = (value: FormDataEntryValue | null) => String(value ?? '').trim() || null;

export async function storeMediaUpload(
  slug: string,
  formData: FormData,
): Promise<{ count: number }> {
  const files = formData.getAll('files').filter((value): value is File => value instanceof File);
  return storeMediaFiles(slug, files, {
    folderId: nullableString(formData.get('folderId')),
    uploadRequestId: nullableString(formData.get('uploadRequestId')),
  });
}

/**
 * Stores files that have already been read off the wire.
 *
 * The route handler uses this with a single file taken from a raw request body.
 * Multipart is deliberately avoided for anything large: Node's parser fails
 * outright on bodies past roughly 10 MB with "Failed to parse body as
 * FormData", which surfaced as an opaque 500 on a perfectly valid photo.
 */
export async function storeMediaFiles(
  slug: string,
  files: File[],
  options: { folderId?: string | null; uploadRequestId?: string | null } = {},
): Promise<{ count: number }> {
  const ctx = await requireWorkspace(slug, 'media:upload');
  if (!files.length) throw invalid('Choose at least one file.');
  const folderId = options.folderId ?? null;
  if (folderId) await requireFolder(ctx.workspace.id, folderId);
  const suppliedRequestId = options.uploadRequestId ?? null;
  if (suppliedRequestId && suppliedRequestId.length > 200) throw invalid('The upload request identifier is invalid.');
  // Validate the whole batch before storing anything. A bad second file must
  // not leave the first file uploaded while the UI reports a failed batch.
  const fileTypes = validateMediaUploads(files);
  const prepared = await Promise.all(files.map(async (file, index) => {
    const type = fileTypes[index];
    const bytes = Buffer.from(await file.arrayBuffer());
    // Older clients do not yet send an identifier. A content-derived fallback
    // still makes an uncertain retry converge; intentional duplicates remain
    // available through the library's explicit Copy action.
    const uploadRequestId = suppliedRequestId
      ?? `content:${createHash('sha256').update(bytes).digest('hex')}`;
    const id = uploadAssetId(ctx.workspace.id, uploadRequestId, index, file);
    return { id, size: file.size, file, type, bytes };
  }));
  const plan = await workspacePlan(ctx.workspace.id);
  // Reserve every new row in one serializable transaction. The aggregate and
  // complete batch are checked together before the first object-store write.
  const assets = await db.$transaction(async (tx) => {
    const [usage, existing] = await Promise.all([
      tx.mediaAsset.aggregate({
        where: { workspaceId: ctx.workspace.id },
        _sum: { size: true },
      }),
      tx.mediaAsset.findMany({
        where: { id: { in: prepared.map(({ id }) => id) }, workspaceId: ctx.workspace.id },
        select: { id: true },
      }),
    ]);
    const existingIds = new Set(existing.map(({ id }) => id));
    assertStorageUploadWithinPlan(
      plan,
      usage._sum.size ?? 0,
      newUploadBytes(prepared, existingIds),
    );
    return Promise.all(prepared.map(({ id, file, type }) => tx.mediaAsset.upsert({
        where: { id },
        update: {},
        create: {
          id,
          workspaceId: ctx.workspace.id,
          folderId,
          uploadedById: ctx.user.id,
          filename: file.name,
          mimeType: file.type,
          type,
          size: file.size,
          storageKey: mediaKey(ctx.workspace.id, file.name),
          status: 'UPLOADING',
        },
      })));
  }, { isolationLevel: 'Serializable' });
  for (const [index, asset] of assets.entries()) {
    const { bytes, file } = prepared[index];
    // PROCESSING/READY means an earlier attempt crossed the durable storage
    // boundary. UPLOADING retries safely overwrite the same object key.
    if (asset.status !== 'UPLOADING') continue;
    await storage().put(asset.storageKey, bytes, file.type);
    await markUploaded({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      assetId: asset.id,
      filename: file.name,
      size: file.size,
    });
  }
  revalidatePath(`/w/${slug}/media`);
  return { count: files.length };
}

/**
 * The bookkeeping that follows bytes reaching storage.
 *
 * Its own function because two routes need it: the one that receives the bytes
 * itself, and the one a browser calls after writing them straight to object
 * storage through a presigned URL.
 *
 * Guarded on UPLOADING, so calling it twice — a retried request, a browser that
 * did not hear the first answer — cannot enqueue the processing job twice.
 */
export async function markUploaded(input: {
  workspaceId: string;
  userId: string;
  assetId: string;
  filename: string;
  size: number;
}): Promise<boolean> {
  const claimed = await db.mediaAsset.updateMany({
    where: { id: input.assetId, status: 'UPLOADING' },
    data: { status: 'PROCESSING' },
  });
  if (!claimed.count) return false;

  await enqueue('process-media', { mediaAssetId: input.assetId }, {
    workspaceId: input.workspaceId,
    dedupeKey: `process-media:${input.assetId}`,
  });
  await audit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: 'media.uploaded',
    entityType: 'media_asset',
    entityId: input.assetId,
    metadata: { filename: input.filename, size: input.size },
  });
  return true;
}

/**
 * A row and a place to write, without the bytes.
 *
 * The browser sends only what the file claims to be; the object itself goes
 * straight to storage. Everything that decides whether an upload is allowed —
 * the type, the size, the workspace's storage allowance — is checked here,
 * before a URL is handed out, because after that point this application never
 * sees the request again.
 *
 * `size` is therefore the size the browser reported. It governs the quota check
 * and the stored row; the object store enforces nothing about it. A client that
 * lied would be caught when the asset is processed, not here.
 */
export async function reserveMediaUpload(
  slug: string,
  file: { name: string; type: string; size: number },
  options: { folderId?: string | null; uploadRequestId?: string | null } = {},
): Promise<{ assetId: string; storageKey: string; uploadUrl: string | null }> {
  const ctx = await requireWorkspace(slug, 'media:upload');
  const [type] = validateMediaUploads([file]);

  const folderId = options.folderId ?? null;
  if (folderId) await requireFolder(ctx.workspace.id, folderId);

  // The byte-hash fallback the other path uses is not available here — these
  // bytes never arrive — so an absent identifier falls back to what the file
  // declares about itself. Weaker, and enough: a retry of the same pick still
  // converges on the same row.
  const supplied = options.uploadRequestId?.trim();
  if (supplied && supplied.length > 200) throw invalid('The upload request identifier is invalid.');
  const uploadRequestId = supplied
    || `declared:${file.name}:${file.size}:${file.type}:${folderId ?? 'root'}`;

  const id = uploadAssetId(ctx.workspace.id, uploadRequestId, 0, file);
  const plan = await workspacePlan(ctx.workspace.id);

  const asset = await db.$transaction(async (tx) => {
    const [usage, existing] = await Promise.all([
      tx.mediaAsset.aggregate({ where: { workspaceId: ctx.workspace.id }, _sum: { size: true } }),
      tx.mediaAsset.findFirst({ where: { id, workspaceId: ctx.workspace.id }, select: { id: true } }),
    ]);
    assertStorageUploadWithinPlan(plan, usage._sum.size ?? 0, existing ? 0 : file.size);
    return tx.mediaAsset.upsert({
      where: { id },
      update: {},
      create: {
        id,
        workspaceId: ctx.workspace.id,
        folderId,
        uploadedById: ctx.user.id,
        filename: file.name,
        mimeType: file.type,
        type,
        size: file.size,
        storageKey: mediaKey(ctx.workspace.id, file.name),
        status: 'UPLOADING',
      },
    });
  }, { isolationLevel: 'Serializable' });

  const driver = storage();
  const uploadUrl = driver.signedUploadUrl
    ? await driver.signedUploadUrl(asset.storageKey, file.type)
    : null;

  return { assetId: asset.id, storageKey: asset.storageKey, uploadUrl };
}
