import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { YOUTUBE_PRIVACY_STATUS: 'public' } }));

import { isYoutubePrivacy, privacyFor } from '@/lib/social/adapters/youtube';

const account = (metadata: Record<string, unknown>) => ({ metadata });

describe('privacyFor', () => {
  it('uses the visibility set on that channel', () => {
    expect(privacyFor(account({ privacyStatus: 'private' }))).toBe('private');
    expect(privacyFor(account({ privacyStatus: 'unlisted' }))).toBe('unlisted');
  });

  /**
   * A channel connected before this setting existed has nothing stored, and
   * must keep publishing the way the deployment already did rather than
   * silently switching visibility on its next upload.
   */
  it('falls back to the deployment setting when the channel has none', () => {
    expect(privacyFor(account({}))).toBe('public');
    expect(privacyFor(account({ channelId: 'UC123' }))).toBe('public');
  });

  it('ignores a stored value YouTube does not offer', () => {
    expect(privacyFor(account({ privacyStatus: 'semi-public' }))).toBe('public');
    expect(privacyFor(account({ privacyStatus: 42 }))).toBe('public');
  });

  it('knows which values are real', () => {
    expect(['public', 'unlisted', 'private'].every(isYoutubePrivacy)).toBe(true);
    expect(isYoutubePrivacy('hidden')).toBe(false);
  });
});
