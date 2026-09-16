import 'server-only';
import { storage } from '@/lib/storage';
import { profileImageKey } from '@/lib/users/profile-image';

/**
 * A URL that will actually load, for an avatar to render right now.
 *
 * Signed fresh on every render rather than stored, which is the whole point:
 * a signature has a short life and a database row does not. An OAuth
 * provider's avatar URL is passed through untouched — it is not ours to sign.
 *
 * Kept out of profile-image.ts so the pure helpers there stay importable from
 * anywhere, including tests, without dragging in the storage driver.
 */
export async function profileImageSrc(
  stored: string | null | undefined,
): Promise<string | undefined> {
  const key = profileImageKey(stored);
  if (!key) return stored ?? undefined;
  // A deleted or unreachable object must not take the whole page down; the
  // Avatar falls back to initials on undefined.
  return storage().signedUrl(key).catch(() => undefined);
}
