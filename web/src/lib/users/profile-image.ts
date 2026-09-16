import { publicEnv } from '@/lib/env';

/**
 * Profile images, which arrive from two very different places.
 *
 * `User.image` holds either an avatar URL an OAuth provider gave us, which we
 * neither own nor can sign, or a key for an image the user uploaded into our
 * own bucket. Storing a *signed URL* for the second case — which is what this
 * module replaced — is wrong twice over: S3 and R2 refuse to sign anything
 * more than seven days out, so the upload failed outright, and even a
 * successful signature would have gone stale and left a broken avatar behind.
 *
 * So the key is what gets stored, and the URL is minted per render.
 */

/** users/<userId>/profile/<filename> */
const MANAGED = /users\/[^/]+\/profile\/[^/?#]+$/;

/**
 * The bucket key behind a stored profile image, or null if it is somebody
 * else's URL.
 *
 * Accepts a bare key (what is stored now) and a full signed URL (what older
 * rows hold), so no migration is needed to read existing avatars — the key was
 * always sitting inside that URL's path.
 */
export function profileImageKey(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(stored)) {
    return MANAGED.test(stored) ? stored : null;
  }
  try {
    const path = decodeURIComponent(new URL(stored, publicEnv.appUrl).pathname);
    const start = path.indexOf('users/');
    if (start < 0) return null;
    const key = path.slice(start);
    return MANAGED.test(key) ? key : null;
  } catch {
    return null;
  }
}

/**
 * The same key, but only when it belongs to this user.
 *
 * Used before deleting a replaced avatar: the userId check is what stops a
 * crafted value pointing the delete at another user's object.
 */
export function ownedProfileImageKey(
  stored: string | null | undefined,
  userId: string,
): string | null {
  const key = profileImageKey(stored);
  return key?.startsWith(`users/${userId}/profile/`) ? key : null;
}
