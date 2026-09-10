import { MediaType } from '@prisma/client';
import { invalid } from '@/lib/errors';

export const MAX_MEDIA_BYTES = 250 * 1024 * 1024;

export const MEDIA_MIME_TYPES = new Map<string, MediaType>([
  ['image/jpeg', MediaType.IMAGE],
  ['image/png', MediaType.IMAGE],
  ['image/webp', MediaType.IMAGE],
  ['image/gif', MediaType.GIF],
  ['video/mp4', MediaType.VIDEO],
  ['video/quicktime', MediaType.VIDEO],
  ['video/webm', MediaType.VIDEO],
  ['audio/mpeg', MediaType.AUDIO],
]);

export function validateMediaUpload(file: Pick<File, 'name' | 'type' | 'size'>): MediaType {
  const type = MEDIA_MIME_TYPES.get(file.type);
  if (!type) throw invalid(`${file.name} has an unsupported file type.`);
  if (file.size <= 0) throw invalid(`${file.name} is empty.`);
  if (file.size > MAX_MEDIA_BYTES) throw invalid(`${file.name} is larger than 250 MB.`);
  return type;
}

export function validateMediaUploads(files: Pick<File, 'name' | 'type' | 'size'>[]): MediaType[] {
  return files.map(validateMediaUpload);
}
