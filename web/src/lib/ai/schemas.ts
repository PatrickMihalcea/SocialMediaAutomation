import { z } from 'zod';
import {
  normalizeAssistantAction,
  proposedWorkflowEdgeSchema,
  proposedWorkflowNodeSchema,
  workflowGraphEditSchema,
} from '@/lib/workflows/assistant-graph';

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
  // Preprocessed rather than described harder in the prompt: the model reaches
  // for its own spelling of these field names often enough that repairing them
  // is worth more than another paragraph of instructions telling it not to.
  action: z
    .preprocess(normalizeAssistantAction, z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('create_drafts'),
        summary: z.string().min(1).max(500),
        posts: z.array(
          z.object({
            title: z.string().min(1).max(200).optional(),
            text: z.string().min(1).max(65_000),
            hashtags: z.array(z.string().max(100)).max(30).default([]),
          }).strict(),
        ).min(1).max(10),
      }).strict(),
      z.object({
        kind: z.literal('schedule_posts'),
        summary: z.string().min(1).max(500),
        posts: z.array(z.object({
          postId: z.string().uuid(),
          postTitle: z.string().min(1).max(200),
        }).strict()).min(1).max(50),
        weekdays: z.array(z.number().int().min(0).max(6)).default([]),
        hour: z.number().int().min(0).max(23).default(9),
        minute: z.number().int().min(0).max(59).default(0),
      }).strict(),
      z.object({
        kind: z.literal('assign_campaign'),
        summary: z.string().min(1).max(500),
        postId: z.string().uuid(),
        postTitle: z.string().min(1).max(200),
        campaignId: z.string().uuid(),
        campaignName: z.string().min(1).max(200),
      }).strict(),
      z.object({
        kind: z.literal('attach_media'),
        summary: z.string().min(1).max(500),
        postId: z.string().uuid(),
        postTitle: z.string().min(1).max(200),
        media: z.array(z.object({
          mediaAssetId: z.string().uuid(),
          filename: z.string().min(1).max(500),
          altText: z.string().max(2_000).nullable().default(null),
        }).strict()).min(1).max(35),
      }).strict(),
      z.object({
        kind: z.literal('update_post_content'),
        summary: z.string().min(1).max(500),
        postId: z.string().uuid(),
        postTitle: z.string().min(1).max(200),
        title: z.string().min(1).max(200).nullable().optional(),
        text: z.string().min(1).max(65_000),
        hashtags: z.array(z.string().max(100)).max(30).default([]),
      }).strict(),
      z.object({
        kind: z.literal('repurpose_content'),
        summary: z.string().min(1).max(500),
        sourcePostId: z.string().uuid(),
        sourcePostTitle: z.string().min(1).max(200),
        newTitle: z.string().min(1).max(200),
        text: z.string().min(1).max(65_000),
        hashtags: z.array(z.string().max(100)).max(30).default([]),
      }).strict(),
      z.object({
        kind: z.literal('create_workflow'),
        summary: z.string().min(1).max(500),
        name: z.string().min(2).max(120),
        description: z.string().max(1000).nullable().optional(),
        scheduleEnabled: z.boolean().default(false),
        scheduleWeekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
        scheduleHour: z.number().int().min(0).max(23).default(9),
        scheduleMinute: z.number().int().min(0).max(59).default(0),
        nodes: z.array(proposedWorkflowNodeSchema).min(1).max(20),
        edges: z.array(proposedWorkflowEdgeSchema).max(40).default([]),
        /** Filled after the user confirms, so the assistant can link to the editor. */
        workflowId: z.string().uuid().optional(),
      }).strict(),
      z.object({
        kind: z.literal('update_workflow'),
        summary: z.string().min(1).max(500),
        workflowId: z.string().uuid(),
        workflowName: z.string().min(1).max(200),
        name: z.string().min(2).max(120).optional(),
        description: z.string().max(1000).nullable().optional(),
        scheduleEnabled: z.boolean().optional(),
        scheduleWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
        scheduleHour: z.number().int().min(0).max(23).optional(),
        scheduleMinute: z.number().int().min(0).max(59).optional(),
        nodeUpdates: z.array(z.object({
          nodeId: z.string().uuid(),
          name: z.string().min(1).max(80).optional(),
          config: z.record(z.string(), z.unknown()).optional(),
        }).strict()).max(20).default([]),
        graphEdits: z.array(workflowGraphEditSchema).max(40).default([]),
      }).strict(),
      z.object({
        kind: z.literal('run_workflow'),
        summary: z.string().min(1).max(500),
        workflowId: z.string().uuid(),
        workflowName: z.string().min(1).max(200),
        /** Filled after confirmation so the completed action links to live run details. */
        runId: z.string().uuid().optional(),
      }).strict(),
    ]))
    .nullable()
    .default(null),
}).strict();
export type AssistantReply = z.infer<typeof assistantReplySchema>;

/**
 * Prompts produced by a workflow's idea step. `title` is what a text overlay
 * can burn onto the clip, so it is kept short and human — "Coastal minimal",
 * not a restatement of the prompt.
 */
export const imagePromptsSchema = z.object({
  postTitle: z.string().min(1).max(200),
  /**
   * Copy for the post itself, kept optional so a model that answers with only
   * prompts still produces a usable step — the publish step falls back to
   * whatever caption was typed into it.
   */
  caption: z.string().max(5000).default(''),
  hashtags: z.array(z.string().max(100)).max(30).default([]),
  additionalOutputs: z.record(z.string().max(200)).default({}),
  prompts: z
    .array(
      z.object({
        title: z.string().max(80),
        /**
         * Where this one is set, in a few words — "coastal cliff at dusk",
         * "dense rainforest canopy".
         *
         * Recorded so a later run can be told what has already been used. A
         * title is two or three words chosen to look good burned onto a video,
         * and asking a model not to repeat "Glacier canopy" simply produced
         * "Alpine loft" — the same scene under another name. The setting is
         * the thing that was actually repeating, so it is the thing to name.
         */
        setting: z.string().max(120).default(''),
        prompt: z.string().max(2000),
      }),
    )
    .min(1)
    .max(20),
});
export type ImagePrompts = z.infer<typeof imagePromptsSchema>;
