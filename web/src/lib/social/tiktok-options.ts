import { z } from 'zod';

/**
 * The settings TikTok requires a person to choose for each post.
 *
 * TikTok's Direct Post rules say who can see a post is picked by the creator
 * every time, with nothing chosen in advance, and that comments, duets and
 * stitches start off. Nothing here has a default that posts on the creator's
 * behalf.
 */
export const TIKTOK_PRIVACY_LEVELS = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
] as const;

export type TikTokPrivacyLevel = (typeof TIKTOK_PRIVACY_LEVELS)[number];

export const TIKTOK_PRIVACY_LABELS: Record<TikTokPrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: 'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
};

export const tiktokPostOptionsSchema = z.object({
  privacyLevel: z.enum(TIKTOK_PRIVACY_LEVELS).nullable().default(null),
  allowComment: z.boolean().default(false),
  allowDuet: z.boolean().default(false),
  allowStitch: z.boolean().default(false),
  /** "Disclose video content": the post promotes a brand, product or service. */
  commercial: z.boolean().default(false),
  /** Promoting the creator's own business. TikTok labels it "Promotional content". */
  yourBrand: z.boolean().default(false),
  /** Promoting someone else's. TikTok labels it "Paid partnership". */
  brandedContent: z.boolean().default(false),
});

export type TikTokPostOptions = z.infer<typeof tiktokPostOptionsSchema>;

export const emptyTikTokOptions = (): TikTokPostOptions => tiktokPostOptionsSchema.parse({});

/** What TikTok says this creator can do right now, from creator_info. */
export type TikTokCreatorInfo = {
  nickname: string;
  username: string;
  avatarUrl: string | null;
  privacyLevels: TikTokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoSeconds: number | null;
};

/**
 * Why these settings cannot be posted as they are, or null when they can.
 *
 * Shared by the composer, which shows it, and the adapter, which refuses to
 * post without it, so the two can never disagree.
 */
export function tiktokOptionsProblem(options: TikTokPostOptions | null | undefined): string | null {
  if (!options?.privacyLevel) return 'Choose who can see this TikTok post.';
  if (options.commercial && !options.yourBrand && !options.brandedContent) {
    return 'You need to indicate if your content promotes yourself, a third party, or both.';
  }
  if (options.brandedContent && options.privacyLevel === 'SELF_ONLY') {
    return 'Branded content visibility cannot be set to private.';
  }
  return null;
}

/** The consent line TikTok requires right above the post button. */
export function tiktokDeclaration(options: TikTokPostOptions | null | undefined): string {
  return options?.commercial && options.brandedContent
    ? "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation."
    : "By posting, you agree to TikTok's Music Usage Confirmation.";
}
