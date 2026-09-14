/**
 * Uploads files to the media route handler, one request per file.
 *
 * Deliberately not a Server Action and deliberately not multipart: actions cap
 * the body at 1 MB, and Node's multipart parser fails past roughly 10 MB. The
 * bytes go up as the raw request body with the metadata in the query string,
 * which has neither ceiling.
 *
 * Files are uploaded in sequence so a large batch cannot open a dozen
 * simultaneous connections, and every failure is reported against its filename
 * rather than collapsing the batch into one message.
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
    const query = new URLSearchParams({ filename: file.name });
    if (folderId) query.set('folderId', folderId);
    // Keep each file's identity stable across a retry of the same batch.
    if (uploadRequestId) query.set('uploadRequestId', `${uploadRequestId}:${index}`);

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
      failures.push(`${file.name}: ${payload.error ?? 'upload failed'}`);
    }
  }

  if (failures.length === files.length) throw new Error(failures.join('; '));
  if (failures.length) throw new Error(`Some files did not upload — ${failures.join('; ')}`);
  return { message: files.length === 1 ? 'Media uploaded.' : `${files.length} files uploaded.` };
}

const asText = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value.trim() : '');
