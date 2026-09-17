import type { Platform, PostStatus } from '@prisma/client';
import type { PostPlatformInput } from '@/lib/posts/schemas';
import { parseTagList } from '@/lib/posts/tags';

export type ComposerAccount = {
  id: string;
  accountName: string;
  accountHandle: string | null;
  platform: Platform;
  isDemo: boolean;
};

export type ComposerAsset = {
  /**
   * The asset itself. Distinct from thumbnailUrl because a video preview needs
   * both: the file to play, and a poster to show before it plays.
   */
  url: string;
  id: string;
  filename: string;
  type: string;
  /** PROCESSING means a render is still filling this in. */
  status?: string;
  thumbnailUrl: string;
  /**
   * Audio only — the start point stored on the track, seconds. Used to seed a
   * post's own start when the track is attached; null when none is set.
   */
  audioStart?: number | null;
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
  media: Array<{
    mediaAssetId: string;
    altText: string;
    thumbnailOffset: string;
    /** Soundtrack chosen here, rendered at publish time. Empty means none. */
    audioAssetId?: string;
    audioStart?: string;
  }>;
};

export type ComposerDraft = {
  title: string;
  campaignId: string;
  scheduledAt: string;
  activeAccountId: string;
  selectedAccountIds: string[];
  /**
   * One post across every channel, which is what people almost always mean.
   * Off means each channel is edited on its own.
   */
  samePost: boolean;
  /** Channels that opted out of the shared post and keep their own content. */
  customAccountIds: string[];
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
    media: Array<{
      mediaAssetId: string;
      altText: string | null;
      thumbnailOffset: number | null;
      audioAssetId?: string | null;
      audioStart?: number | null;
    }>;
  }>;
};

/**
 * Whether two channel versions say the same thing.
 *
 * Compared field by field rather than by JSON string: key order is not
 * meaningful, and media is compared by what it points at, not by the empty
 * strings the form keeps beside it.
 */
export function versionsMatch(a: PlatformVersionState, b: PlatformVersionState): boolean {
  return (
    a.text === b.text &&
    a.hashtags === b.hashtags &&
    a.mentions === b.mentions &&
    a.link === b.link &&
    a.firstComment === b.firstComment &&
    a.media.length === b.media.length &&
    a.media.every((item, index) => {
      const other = b.media[index];
      return (
        other &&
        item.mediaAssetId === other.mediaAssetId &&
        item.altText === other.altText &&
        (item.audioAssetId ?? '') === (other.audioAssetId ?? '') &&
        (item.audioStart ?? '') === (other.audioStart ?? '')
      );
    })
  );
}

/** The content of one version, without the identity of the channel it is on. */
export function versionContent(version: PlatformVersionState): Partial<PlatformVersionState> {
  return {
    text: version.text,
    hashtags: version.hashtags,
    mentions: version.mentions,
    link: version.link,
    firstComment: version.firstComment,
    media: version.media.map((item) => ({ ...item })),
  };
}

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

export type ComposerWorkspaceDefaults = {
  defaultHashtags?: string[];
  defaultCta?: string;
};

const attachedMedia = (assetId: string) => [
  { mediaAssetId: assetId, altText: '', thumbnailOffset: '', audioAssetId: '', audioStart: '' },
];

export function buildInitialDraft(
  accounts: ComposerAccount[],
  initial?: ComposerInitial,
  attachAssetId?: string,
  defaults: { scheduledAt?: string; campaignId?: string } & ComposerWorkspaceDefaults = {},
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
            audioAssetId: m.audioAssetId ?? '',
            audioStart: m.audioStart != null ? String(m.audioStart) : '',
          })),
        }
      : {
          ...emptyVersion(account),
          text: defaults.defaultCta ?? '',
          hashtags: (defaults.defaultHashtags ?? []).map((tag) => `#${tag.replace(/^#/, '')}`).join(', '),
        };
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
    // A new post starts shared. An existing one starts however it was left: if
    // its channels already say different things, turning this on would be an
    // unasked-for edit to every one of them.
    samePost: selectedVersionsMatch(initial, accounts, versions),
    customAccountIds: [],
    versions,
  };
}

function selectedVersionsMatch(
  initial: ComposerInitial | undefined,
  accounts: ComposerAccount[],
  versions: Record<string, PlatformVersionState>,
): boolean {
  if (!initial) return true;
  const selected = initial.platforms
    .map((platform) => platform.socialAccountId)
    .filter((accountId) => accounts.some((account) => account.id === accountId))
    .map((accountId) => versions[accountId])
    .filter(Boolean);
  return selected.every((version) => versionsMatch(version, selected[0]));
}

function mapVersion(version: PlatformVersionState): PostPlatformInput {
  return {
    socialAccountId: version.socialAccountId,
    platform: version.platform,
    text: version.text,
    firstComment: version.firstComment.trim() ? version.firstComment : null,
    hashtags: parseTagList(version.hashtags, '#'),
    mentions: parseTagList(version.mentions, '@'),
    link: version.link.trim() || null,
    media: version.media.map((item) => ({
      mediaAssetId: item.mediaAssetId,
      altText: item.altText.trim() || null,
      thumbnailOffset: item.thumbnailOffset.trim()
        ? Number.parseFloat(item.thumbnailOffset)
        : null,
      // Only meaningful together: a start offset with no track is nothing.
      audioAssetId: item.audioAssetId?.trim() || null,
      // Rounded to the millisecond the field offers: binary floats turn a
      // typed 12.345 into 12.344999999999999, which then reads back into the
      // box as a number nobody entered.
      audioStart: item.audioAssetId?.trim() && item.audioStart?.trim()
        ? Math.round(Number.parseFloat(item.audioStart) * 1000) / 1000
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
