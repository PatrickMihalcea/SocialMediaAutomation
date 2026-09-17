import { Platform, PostStatus } from '@prisma/client';
import { z } from 'zod';

export const postPlatformInputSchema = z.object({
  socialAccountId: z.string().uuid(),
  platform: z.nativeEnum(Platform),
  text: z.string().max(65_000),
  firstComment: z.string().max(5_000).nullable().optional(),
  hashtags: z.array(z.string().max(100)).max(30).default([]),
  mentions: z.array(z.string().max(100)).max(30).default([]),
  link: z.string().url().nullable().optional().or(z.literal('')),
  media: z
    .array(
      z.object({
        mediaAssetId: z.string().uuid(),
        altText: z.string().max(2_000).nullable().optional(),
        thumbnailOffset: z.number().min(0).nullable().optional(),
        /** Soundtrack: stored as intent, rendered when the post publishes. */
        audioAssetId: z.string().uuid().nullable().optional(),
        audioStart: z.number().min(0).max(3_600).nullable().optional(),
      }),
    )
    .max(35)
    .default([]),
});

export const savePostSchema = z.object({
  id: z.string().uuid().optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
  title: z.string().max(200).nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  timezone: z.string().min(1).max(100),
  status: z
    .enum([
      PostStatus.DRAFT,
      PostStatus.PENDING_APPROVAL,
      PostStatus.APPROVED,
      PostStatus.SCHEDULED,
    ])
    .default(PostStatus.DRAFT),
  platforms: z
    .array(postPlatformInputSchema)
    .min(1)
    .superRefine((platforms, context) => {
      const seen = new Set<string>();
      platforms.forEach((platform, index) => {
        if (seen.has(platform.socialAccountId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'socialAccountId'],
            message: 'Each social account can only have one post version.',
          });
        }
        seen.add(platform.socialAccountId);
      });
    }),
});

export type PostPlatformInput = z.infer<typeof postPlatformInputSchema>;
export type SavePostInput = z.infer<typeof savePostSchema>;
