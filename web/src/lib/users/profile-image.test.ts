import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ publicEnv: { appUrl: 'http://localhost:3000' } }));

import { ownedProfileImageKey, profileImageKey } from '@/lib/users/profile-image';

const USER = '11111111-2222-3333-4444-555555555555';
const KEY = `users/${USER}/profile/abc.png`;

describe('profileImageKey', () => {
  it('passes a stored key straight through', () => {
    expect(profileImageKey(KEY)).toBe(KEY);
  });

  /*
   * Rows written before the key was stored hold a full signed URL. The key was
   * always inside its path, so old avatars keep resolving with no migration.
   */
  it('recovers the key from a legacy local signed URL', () => {
    expect(profileImageKey(`http://localhost:3000/api/storage/${KEY}?expires=1&token=aa`)).toBe(KEY);
  });

  it('recovers the key from a legacy S3 presigned URL', () => {
    expect(
      profileImageKey(`https://acct.r2.cloudflarestorage.com/bridge88/${KEY}?X-Amz-Signature=deadbeef`),
    ).toBe(KEY);
  });

  it('decodes a percent-encoded path', () => {
    expect(profileImageKey(`http://localhost:3000/api/storage/users/${USER}/profile/my%20face.png`))
      .toBe(`users/${USER}/profile/my face.png`);
  });

  /*
   * An OAuth provider's avatar is not ours and cannot be signed; returning a
   * key for it would send the renderer to our bucket for an object that was
   * never there.
   */
  it.each([
    'https://lh3.googleusercontent.com/a/ACg8ocK',
    'https://avatars.githubusercontent.com/u/42',
  ])('leaves the provider URL %s alone', (url) => {
    expect(profileImageKey(url)).toBeNull();
  });

  it.each([null, undefined, '', 'users/only', 'uploads/other/file.png'])(
    'returns null for %j',
    (value) => expect(profileImageKey(value)).toBeNull(),
  );
});

describe('ownedProfileImageKey', () => {
  it('returns the key when it belongs to this user', () => {
    expect(ownedProfileImageKey(KEY, USER)).toBe(KEY);
  });

  /*
   * This is the check that keeps a delete pointed at the caller's own object.
   */
  it('refuses another user’s key', () => {
    expect(ownedProfileImageKey(KEY, 'someone-else')).toBeNull();
  });
});
