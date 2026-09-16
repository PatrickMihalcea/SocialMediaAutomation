import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({ appUrl: 'https://studio.example.test' }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: { AUTH_SECRET: 'a-test-secret-at-least-16-chars' },
  get publicEnv() {
    return { appUrl: envMock.appUrl };
  },
}));

import { LocalStorage, verifyKeySignature } from '@/lib/storage/local';

describe('local storage signed URLs', () => {
  beforeEach(() => {
    envMock.appUrl = 'https://studio.example.test';
  });

  /**
   * Instagram and TikTok publish by fetching the media themselves. A relative
   * path is something only a browser can resolve, so it reached the platform as
   * an unusable URL and came back as a generic media error — nothing in the app
   * looked wrong, because every other consumer renders it in an <img>.
   */
  it('is absolute, so a platform that fetches the media can resolve it', async () => {
    const url = new URL(await new LocalStorage().signedUrl('workspaces/w1/original/clip.mp4'));

    expect(url.origin).toBe('https://studio.example.test');
    expect(url.pathname).toBe('/api/storage/workspaces/w1/original/clip.mp4');
  });

  it('follows the configured origin rather than a baked-in one', async () => {
    envMock.appUrl = 'https://abc123.ngrok-free.app';

    const url = await new LocalStorage().signedUrl('workspaces/w1/original/clip.mp4');

    expect(url.startsWith('https://abc123.ngrok-free.app/api/storage/')).toBe(true);
  });

  it('signs a token the storage route accepts, and refuses an expired one', async () => {
    const key = 'workspaces/w1/original/clip.mp4';
    const url = new URL(await new LocalStorage().signedUrl(key, 600));
    const expires = Number(url.searchParams.get('expires'));
    const token = url.searchParams.get('token')!;

    expect(verifyKeySignature(key, expires, token)).toBe(true);
    expect(verifyKeySignature(key, Date.now() - 1000, token)).toBe(false);
    // A token minted for one object must not unlock another.
    expect(verifyKeySignature('workspaces/w1/original/other.mp4', expires, token)).toBe(false);
  });

  it('escapes a key that would otherwise change the path or the query', async () => {
    const url = new URL(await new LocalStorage().signedUrl('workspaces/w1/a b?x=1/clip.mp4'));

    expect(url.pathname).toBe('/api/storage/workspaces/w1/a%20b%3Fx%3D1/clip.mp4');
    expect(url.searchParams.get('x')).toBeNull();
  });
});
