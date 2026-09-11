import { describe, expect, it } from 'vitest';
import { Platform } from '@prisma/client';
import {
  buildInitialDraft,
  draftStorageKey,
  versionsToPayload,
  type ComposerAccount,
} from '@/lib/posts/composer';

const accounts: ComposerAccount[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    accountName: 'Demo',
    accountHandle: '@demo',
    platform: Platform.MOCK,
    isDemo: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    accountName: 'LinkedIn',
    accountHandle: '@acme',
    platform: Platform.LINKEDIN,
    isDemo: false,
  },
];

describe('composer helpers', () => {
  it('builds per-account drafts from saved post data', () => {
    const draft = buildInitialDraft(accounts, {
      title: 'Q4',
      campaignId: null,
      scheduledAt: '2026-09-15T09:00',
      updatedAt: '2026-09-10T12:00:00.000Z',
      status: 'DRAFT',
      platforms: [
        {
          socialAccountId: accounts[0].id,
          platform: Platform.MOCK,
          text: 'Saved copy',
          firstComment: null,
          hashtags: ['launch'],
          mentions: ['bridge88'],
          link: null,
          media: [],
        },
      ],
    });
    expect(draft.title).toBe('Q4');
    expect(draft.versions[accounts[0].id].text).toBe('Saved copy');
    expect(draft.versions[accounts[0].id].hashtags).toBe('launch');
    expect(draft.versions[accounts[0].id].mentions).toBe('@bridge88');
    expect(draft.versions[accounts[1].id].text).toBe('');
    expect(draft.selectedAccountIds).toEqual([accounts[0].id]);
    expect(draft.sourceUpdatedAt).toBe('2026-09-10T12:00:00.000Z');
  });

  it('serializes every explicitly selected account and no unselected account', () => {
    const draft = buildInitialDraft(accounts);
    draft.versions[accounts[1].id].text = 'LinkedIn version';
    draft.versions[accounts[1].id].hashtags = '#b2b';
    const payload = versionsToPayload(draft.versions, [accounts[1].id]);
    expect(payload).toHaveLength(1);
    expect(payload[0].platform).toBe(Platform.LINKEDIN);
    expect(payload[0].hashtags).toEqual(['b2b']);

    expect(versionsToPayload(draft.versions, [accounts[0].id, accounts[1].id])).toHaveLength(2);
  });

  it('uses stable local draft keys per workspace and post', () => {
    expect(draftStorageKey('acme')).toBe('composer-draft:acme:new');
    expect(draftStorageKey('acme', 'post-1')).toBe('composer-draft:acme:post-1');
  });

  it('prefills a new post with validated calendar and campaign context', () => {
    const draft = buildInitialDraft(accounts, undefined, undefined, {
      scheduledAt: '2026-09-20T09:30',
      campaignId: 'campaign-1',
    });
    expect(draft.scheduledAt).toBe('2026-09-20T09:30');
    expect(draft.campaignId).toBe('campaign-1');
  });

  it('seeds every new platform version from workspace posting defaults', () => {
    const draft = buildInitialDraft(accounts, undefined, undefined, {
      defaultHashtags: ['launch', '#northwind'],
      defaultCta: 'See what is new.',
    });
    expect(draft.versions[accounts[0].id]).toMatchObject({
      text: 'See what is new.',
      hashtags: '#launch, #northwind',
    });
    expect(draft.versions[accounts[1].id]).toMatchObject({
      text: 'See what is new.',
      hashtags: '#launch, #northwind',
    });
  });

  it('appends a requested asset to existing post media without duplicating it', () => {
    const initial = {
      title: 'Media post',
      campaignId: null,
      scheduledAt: null,
      updatedAt: '2026-09-10T12:00:00.000Z',
      status: 'DRAFT' as const,
      platforms: [{
        socialAccountId: accounts[0].id,
        platform: Platform.MOCK,
        text: 'Saved copy',
        firstComment: null,
        hashtags: [],
        mentions: [],
        link: null,
        media: [{
          mediaAssetId: 'asset-existing',
          altText: 'Existing',
          thumbnailOffset: null,
        }],
      }],
    };
    const appended = buildInitialDraft(accounts, initial, 'asset-new');
    expect(appended.versions[accounts[0].id].media.map((media) => media.mediaAssetId))
      .toEqual(['asset-existing', 'asset-new']);
    const unchanged = buildInitialDraft(accounts, initial, 'asset-existing');
    expect(unchanged.versions[accounts[0].id].media).toHaveLength(1);
  });
});
