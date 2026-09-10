import { z } from 'zod';

/**
 * Structured output contracts. Every AI call the application acts on names one
 * of these; free prose is only used where the result is shown to a person and
 * nothing is executed from it.
 */

export const postDraftSchema = z.object({
  text: z.string(),
  hashtags: z.array(z.string()).default([]),
  firstComment: z.string().nullable().default(null),
});
export type PostDraft = z.infer<typeof postDraftSchema>;

export const postVariationsSchema = z.object({
  variations: z.array(z.object({ label: z.string(), text: z.string() })).min(1),
});
export type PostVariations = z.infer<typeof postVariationsSchema>;

export const contentIdeasSchema = z.object({
  ideas: z
    .array(z.object({ title: z.string(), angle: z.string(), hook: z.string() }))
    .min(1),
});
export type ContentIdeas = z.infer<typeof contentIdeasSchema>;

export const platformAdaptationsSchema = z.object({
  versions: z
    .array(
      z.object({
        platform: z.enum(['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'X', 'TIKTOK', 'YOUTUBE']),
        text: z.string(),
        hashtags: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});
export type PlatformAdaptations = z.infer<typeof platformAdaptationsSchema>;

export const hashtagsSchema = z.object({ hashtags: z.array(z.string()).min(1) });

export const brandVoiceSchema = z.object({
  tone: z.string(),
  personality: z.string(),
  targetAudience: z.string(),
  writingStyle: z.string(),
  wordsToUse: z.array(z.string()).default([]),
  wordsToAvoid: z.array(z.string()).default([]),
  emojiPolicy: z.enum(['NONE', 'SPARING', 'FREELY']).default('SPARING'),
  hashtagPolicy: z.enum(['NONE', 'MINIMAL', 'MODERATE', 'HEAVY']).default('MODERATE'),
  ctaStyle: z.string(),
  additionalInstructions: z.string().default(''),
});
export type BrandVoiceDraft = z.infer<typeof brandVoiceSchema>;

export const calendarPlanSchema = z.object({
  posts: z
    .array(
      z.object({
        title: z.string(),
        text: z.string(),
        hashtags: z.array(z.string()).default([]),
        /** Days after the plan's start date. */
        dayOffset: z.number().int().min(0).max(120),
        hour: z.number().int().min(0).max(23).default(9),
      }),
    )
    .min(1),
});
export type CalendarPlan = z.infer<typeof calendarPlanSchema>;

/**
 * The assistant answers in prose *and* may attach one proposed action. The
 * action is never executed from this response — it is stored against the message
 * and only runs after the user confirms it in the UI.
 */
export const assistantReplySchema = z.object({
  reply: z.string(),
  action: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('create_drafts'),
        summary: z.string(),
        posts: z.array(
          z.object({
            title: z.string().optional(),
            text: z.string(),
            hashtags: z.array(z.string()).default([]),
          }),
        ),
      }),
      z.object({
        kind: z.literal('schedule_posts'),
        summary: z.string(),
        postIds: z.array(z.string()).default([]),
        weekdays: z.array(z.number().int().min(0).max(6)).default([]),
        hour: z.number().int().min(0).max(23).default(9),
        minute: z.number().int().min(0).max(59).default(0),
      }),
    ])
    .nullable()
    .default(null),
});
export type AssistantReply = z.infer<typeof assistantReplySchema>;
