/**
 * Uploads files, one at a time, preferring a route straight to object storage.
 *
 * Deliberately not a Server Action and deliberately not multipart: actions cap
 * the body at 1 MB, and Node's multipart parser fails past roughly 10 MB. The
 * bytes go up as the raw request body with the metadata in the query string,
 * which has neither ceiling.
 *
 * Files are uploaded in sequence so a large batch cannot open a dozen
 * simultaneous connections, and every failure is reported against its filename
 * rather than collapsing the batch into one message.
 *
 * Each file is offered to the direct route first. When storage can issue a
 * signed destination the bytes never touch this application, which is the only
 * way past a hosting platform's request body ceiling — Vercel refuses anything
 * over 4.5 MB before a route runs, and the media this product exists to handle
 * is routinely larger. When it cannot, the original path still carries them.
 */
export async function uploadMedia(
  slug: string,
  formData: FormData,
): Promise<{ message: string }> {
  const files = formData.getAll('files').filter((value): value is File => value instanceof File);
  if (!files.length) throw new Error('Choose at least one file.');

  const folderId = asText(formData.get('folderId'));
  const uploadRequestId = asText(formData.get('uploadRequestId'));
  const failures: string[] = [];

  for (const [index, file] of files.entries()) {
    const identity = fileIdentity(file, uploadRequestId, index);
    const query = new URLSearchParams({ filename: file.name });
    if (folderId) query.set('folderId', folderId);
    // Keep each file's identity stable across a retry of the same batch.
    query.set('uploadRequestId', identity);

    const direct = await uploadDirect(slug, file, { folderId, uploadRequestId: identity });
    if (direct === 'done') continue;
    if (direct !== 'unavailable') {
      failures.push(`${file.name}: ${direct}`);
      continue;
    }

    const response = await fetch(
      `/api/workspaces/${encodeURIComponent(slug)}/media/upload?${query}`,
      {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      },
    );

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      failures.push(`${file.name}: ${payload.error ?? describeTransportFailure(response.status, file.size)}`);
    }
  }

  if (failures.length === files.length) throw new Error(failures.join('; '));
  if (failures.length) throw new Error(`Some files did not upload — ${failures.join('; ')}`);
  return { message: files.length === 1 ? 'Media uploaded.' : `${files.length} files uploaded.` };
}

const asText = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value.trim() : '');

/**
 * What went wrong when the response carried no message of its own.
 *
 * A host that refuses the body never reaches the route, so there is no JSON to
 * read and the old fallback said only "upload failed" — which is how a 4.6 MB
 * mp3 became a mystery. The status is the only thing known at that point, so it
 * is what gets reported.
 */
function describeTransportFailure(status: number, size: number): string {
  if (status === 413) {
    return `at ${megabytes(size)} it is larger than this server accepts in one request.`;
  }
  if (status === 504 || status === 408) return 'the upload timed out before it finished.';
  return `upload failed (HTTP ${status}).`;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One file straight to object storage.
 *
 * Returns "done", "unavailable" when this deployment stores media on local
 * disk and has no signed destination to offer, or a message describing what
 * went wrong.
 *
 * A failed PUT deliberately leaves the reserved row behind as UPLOADING rather
 * than deleting it. Retrying the same batch reserves the same id — the id is
 * derived from the upload request — so the retry overwrites the same object
 * instead of creating a second asset, and a row that never receives bytes is
 * visibly unfinished rather than silently absent.
 */
async function uploadDirect(
  slug: string,
  file: File,
  options: { folderId: string; uploadRequestId: string },
): Promise<'done' | 'unavailable' | string> {
  const endpoint = `/api/workspaces/${encodeURIComponent(slug)}/media/upload/direct`;
  const contentType = file.type || 'application/octet-stream';

  const reserved = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: file.name,
      type: file.type,
      size: file.size,
      folderId: options.folderId || null,
      uploadRequestId: options.uploadRequestId || null,
    }),
  });

  if (!reserved.ok) {
    const payload = (await reserved.json().catch(() => ({}))) as { error?: string };
    // A rejection here is the upload's own answer — an unsupported type, a full
    // workspace — and applies to the fallback just as much, so it is reported
    // rather than retried down the other path.
    return payload.error ?? describeTransportFailure(reserved.status, file.size);
  }

  const { assetId, uploadUrl } = (await reserved.json()) as {
    assetId: string;
    uploadUrl: string | null;
  };
  if (!uploadUrl) return 'unavailable';

  const stored = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: file,
  }).catch(() => null);

  // A throw rather than a status is the browser refusing to make the request at
  // all, and in practice that means the bucket has no CORS rule allowing a PUT
  // from this origin. Falling back keeps every upload the platform will still
  // carry working, instead of trading large files for all of them — the
  // reserved row is the id the fallback upserts, so nothing is duplicated.
  if (!stored) return 'unavailable';
  if (!stored.ok) return `storage refused the file (HTTP ${stored.status}).`;

  const finished = await fetch(endpoint, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assetId }),
  });
  if (!finished.ok) {
    const payload = (await finished.json().catch(() => ({}))) as { error?: string };
    return payload.error ?? 'the upload finished but could not be recorded.';
  }
  return 'done';
}

/**
 * What makes this the same upload if it is tried again.
 *
 * The server used to hash the bytes for this, which it can no longer do when
 * the bytes go straight to storage and never reach it. The browser knows
 * something just as stable without reading the file: a pick is identified by
 * its name, its size and its modification time, and re-picking the same file
 * reproduces all three. A retry therefore lands on the row it made last time
 * and overwrites the same object rather than creating a second asset.
 *
 * Two genuinely different files matching on all three would be treated as one.
 * That needs the same name, the same byte count and the same timestamp to the
 * millisecond, which is a copy rather than a coincidence.
 */
function fileIdentity(file: File, batchId: string, index: number): string {
  if (batchId) return `${batchId}:${index}`;
  return `pick:${file.name}:${file.size}:${file.lastModified}`;
}
