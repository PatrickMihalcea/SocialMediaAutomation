import 'server-only';
import { AiOperation, Platform } from '@prisma/client';
import { buildSystemPrompt } from '@/lib/ai/brand-voice';
import { generateObject } from '@/lib/ai';
import {
  brandVoiceSchema,
  calendarPlanSchema,
  contentIdeasSchema,
  hashtagsSchema,
  platformAdaptationsSchema,
  postDraftSchema,
  postVariationsSchema,
} from '@/lib/ai/schemas';

export type WritingOperation =
  | 'generate'
  | 'rewrite'
  | 'shorten'
  | 'expand'
  | 'professional'
  | 'casual'
  | 'hook'
  | 'cta';

export async function generatePost(input: {
  workspaceId: string;
  userId: string;
  prompt: string;
  platform?: Platform;
  operation?: WritingOperation;
}) {
  const system = await buildSystemPrompt({
    workspaceId: input.workspaceId,
    platform: input.platform,
    extra: instructionFor(input.operation ?? 'generate'),
  });
  return (
    await generateObject({
      workspaceId: input.workspaceId,
      userId: input.userId,
      operation: input.operation === 'rewrite' ? AiOperation.REWRITE : AiOperation.CAPTION,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: input.prompt },
        {
          role: 'system',
          content: 'Return JSON: {"text":"post copy","hashtags":["#tag"],"firstComment":null}.',
        },
      ],
      schema: postDraftSchema,
      schemaName: 'post_draft',
    })
  ).object;
}

export async function generateIdeas(input: {
  workspaceId: string;
  userId: string;
  prompt: string;
}) {
  const system = await buildSystemPrompt({ workspaceId: input.workspaceId });
  return (
    await generateObject({
      ...input,
      operation: AiOperation.IDEAS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: input.prompt },
        {
          role: 'system',
          content: 'Return JSON: {"ideas":[{"title":"","angle":"","hook":""}]}.',
        },
      ],
      schema: contentIdeasSchema,
      schemaName: 'content_ideas',
    })
  ).object;
}

export async function adaptPlatforms(input: {
  workspaceId: string;
  userId: string;
  text: string;
  platforms: Platform[];
}) {
  const system = await buildSystemPrompt({ workspaceId: input.workspaceId });
  return (
    await generateObject({
      ...input,
      operation: AiOperation.PLATFORM_ADAPTATION,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Adapt this post for ${input.platforms.join(', ')}. Preserve its facts and intent:\n\n${input.text}`,
        },
        {
          role: 'system',
          content:
            'Return JSON: {"versions":[{"platform":"LINKEDIN","text":"","hashtags":[]}]}. Include only requested platforms.',
        },
      ],
      schema: platformAdaptationsSchema,
      schemaName: 'platform_adaptations',
    })
  ).object;
}

export async function generateHashtags(input: {
  workspaceId: string;
  userId: string;
  text: string;
  platform?: Platform;
}) {
  const system = await buildSystemPrompt({
    workspaceId: input.workspaceId,
    platform: input.platform,
  });
  return (
    await generateObject({
      ...input,
      operation: AiOperation.HASHTAGS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Generate specific hashtags for:\n\n${input.text}` },
        { role: 'system', content: 'Return JSON: {"hashtags":["#example"]}.' },
      ],
      schema: hashtagsSchema,
      schemaName: 'hashtags',
    })
  ).object;
}

export async function generateVariations(input: {
  workspaceId: string;
  userId: string;
  text: string;
}) {
  const system = await buildSystemPrompt({ workspaceId: input.workspaceId });
  return (
    await generateObject({
      ...input,
      operation: AiOperation.REWRITE,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Create three distinct variations of:\n\n${input.text}` },
        {
          role: 'system',
          content: 'Return JSON: {"variations":[{"label":"Direct","text":""}]}.',
        },
      ],
      schema: postVariationsSchema,
      schemaName: 'post_variations',
    })
  ).object;
}

export async function inferBrandVoice(input: {
  workspaceId: string;
  userId: string;
  description: string;
}) {
  return (
    await generateObject({
      ...input,
      operation: AiOperation.CHAT,
      messages: [
        {
          role: 'system',
          content:
            'Turn the business description into a concrete, editable brand voice. Do not invent facts.',
        },
        { role: 'user', content: input.description },
      ],
      schema: brandVoiceSchema,
      schemaName: 'brand_voice',
    })
  ).object;
}

export async function generateCalendar(input: {
  workspaceId: string;
  userId: string;
  prompt: string;
}) {
  const system = await buildSystemPrompt({ workspaceId: input.workspaceId });
  return (
    await generateObject({
      ...input,
      operation: AiOperation.CALENDAR,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: input.prompt },
        { role: 'system', content: 'Return JSON: {"posts":[{"title":"","text":"","hashtags":[],"dayOffset":0,"hour":9}]}.' },
      ],
      schema: calendarPlanSchema,
      schemaName: 'calendar_plan',
    })
  ).object;
}

function instructionFor(operation: WritingOperation): string {
  return {
    generate: 'Write a complete post from the request.',
    rewrite: 'Rewrite the supplied copy without changing its facts.',
    shorten: 'Make the supplied copy materially shorter while preserving its main point.',
    expand: 'Add useful detail without padding or invented claims.',
    professional: 'Use a more professional register without corporate clichés.',
    casual: 'Use a more conversational register without slang that dates quickly.',
    hook: 'Return a strong opening hook, then the original body.',
    cta: 'Keep the body and end with one concrete, low-pressure call to action.',
  }[operation];
}
