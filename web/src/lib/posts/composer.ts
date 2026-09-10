import type { Platform, PostStatus } from '@prisma/client';
import type { PostPlatformInput } from '@/lib/posts/schemas';

export type ComposerAccount = {
  id: string;
  accountName: string;
  accountHandle: string | null;
  platform: Platform;
  isDemo: boolean;
};

export type ComposerAsset = {
  id: string;
  filename: string;
  type: string;
  thumbnailUrl: string;
};

export type ComposerCampaign = {
  id: string;
  name: string;
  color: string;
};

export type PlatformVersionState = {
  socialAccountId: string;
  platform: Platform;
  text: string;
  firstComment: string;
  hashtags: string;
  mentions: string;
  link: string;
  media: Array<{ mediaAssetId: string; altText: string; thumbnailOffset: string }>;
};

export type ComposerDraft = {
  title: string;
  campaignId: string;
  scheduledAt: string;
  activeAccountId: string;
  selectedAccountIds: string[];
  sourceUpdatedAt: string | null;
  versions: Record<string, PlatformVersionState>;
};

export type ComposerInitial = {
  title: string | null;
  campaignId: string | null;
  scheduledAt: string | null;
  updatedAt: string;
  status: PostStatus;
  platforms: Array<{
    socialAccountId: string;
    platform: Platform;
    text: string;
    firstComment: string | null;
    hashtags: string[];
    mentions: string[];
    link: string | null;
    media: Array<{ mediaAssetId: string; altText: string | null; thumbnailOffset: number | null }>;
  }>;
};

export function draftStorageKey(slug: string, postId?: string) {
  return `composer-draft:${slug}:${postId ?? 'new'}`;
}

export function emptyVersion(account: ComposerAccount): PlatformVersionState {
  return {
    socialAccountId: account.id,
    platform: account.platform,
    text: '',
    firstComment: '',
    hashtags: '',
    mentions: '',
    link: '',
    media: [],
  };
}

const attachedMedia = (assetId: string) => [
  { mediaAssetId: assetId, altText: '', thumbnailOffset: '' },
];

export function buildInitialDraft(
  accounts: ComposerAccount[],
  initial?: ComposerInitial,
  attachAssetId?: string,
  defaults: { scheduledAt?: string; campaignId?: string } = {},
): ComposerDraft {
  const versions: Record<string, PlatformVersionState> = {};
  for (const account of accounts) {
    const saved = initial?.platforms.find((p) => p.socialAccountId === account.id);
    versions[account.id] = saved
      ? {
          socialAccountId: account.id,
          platform: account.platform,
          text: saved.text,
          firstComment: saved.firstComment ?? '',
          hashtags: saved.hashtags.join(', '),
          mentions: saved.mentions.map((m) => (m.startsWith('@') ? m : `@${m}`)).join(', '),
          link: saved.link ?? '',
          media: saved.media.map((m) => ({
            mediaAssetId: m.mediaAssetId,
            altText: m.altText ?? '',
            thumbnailOffset: m.thumbnailOffset != null ? String(m.thumbnailOffset) : '',
          })),
        }
      : emptyVersion(account);
  }
  if (attachAssetId) {
    for (const account of accounts) {
      const version = versions[account.id];
      if (!version.media.some((media) => media.mediaAssetId === attachAssetId)) {
        version.media = [...version.media, ...attachedMedia(attachAssetId)];
      }
    }
  }
  return {
    title: initial?.title ?? '',
    campaignId: initial?.campaignId ?? defaults.campaignId ?? '',
    scheduledAt: initial?.scheduledAt ?? defaults.scheduledAt ?? '',
    activeAccountId:
      initial?.platforms.find((platform) =>
        accounts.some((account) => account.id === platform.socialAccountId),
      )?.socialAccountId ??
      accounts[0]?.id ??
      '',
    selectedAccountIds:
      initial?.platforms
        .map((platform) => platform.socialAccountId)
        .filter((accountId) => accounts.some((account) => account.id === accountId)) ??
      accounts.slice(0, 1).map((account) => account.id),
    sourceUpdatedAt: initial?.updatedAt ?? null,
    versions,
  };
}

function parseList(value: string, prefix?: '@' | '#') {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (!prefix) return item;
      const stripped = item.replace(new RegExp(`^${prefix}`), '');
      return stripped ? `${prefix}${stripped}` : '';
    })
    .filter(Boolean);
}

function mapVersion(version: PlatformVersionState): PostPlatformInput {
  return {
    socialAccountId: version.socialAccountId,
    platform: version.platform,
    text: version.text,
    firstComment: version.firstComment.trim() ? version.firstComment : null,
    hashtags: parseList(version.hashtags, '#').map((tag) => tag.replace(/^#/, '')),
    mentions: parseList(version.mentions, '@').map((mention) => mention.replace(/^@/, '')),
    link: version.link.trim() || null,
    media: version.media.map((item) => ({
      mediaAssetId: item.mediaAssetId,
      altText: item.altText.trim() || null,
      thumbnailOffset: item.thumbnailOffset.trim()
        ? Number.parseFloat(item.thumbnailOffset)
        : null,
    })),
  };
}

export function versionsToPayload(
  versions: Record<string, PlatformVersionState>,
  selectedAccountIds: string[],
): PostPlatformInput[] {
  return selectedAccountIds
    .map((accountId) => versions[accountId])
    .filter((version): version is PlatformVersionState => Boolean(version))
    .map(mapVersion);
}

export function readStoredDraft(key: string): ComposerDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as ComposerDraft;
  } catch {
    return null;
  }
}

export function writeStoredDraft(key: string, draft: ComposerDraft) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(draft));
}

export function clearStoredDraft(key: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(key);
}
