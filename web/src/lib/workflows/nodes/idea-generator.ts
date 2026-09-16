import 'server-only';
import { generateObject } from '@/lib/ai';
import { buildSystemPrompt } from '@/lib/ai/brand-voice';
import { imagePromptsSchema } from '@/lib/ai/schemas';
import { PermanentJobError } from '@/lib/queue/runner';
import type { NodeRunContext } from '@/lib/workflows/node-context';

interface Config {
  mode: 'image' | 'text' | 'video';
  theme: string;
  count: number;
  styleSuffix: string;
  titleGuidance: string;
  captionGuidance: string;
  hashtagsGuidance: string;
  additionalOutputs: { id: string; label: string }[];
}

/** Appends the user's direction for one field, if they gave any. */
const directed = (base: string, guidance: string) => {
  const trimmed = guidance.trim();
  return trimmed ? `${base} Follow this direction: ${trimmed}` : base;
};

/**
 * The reply contract for one run.
 *
 * The post's title, caption and tags are always asked for and always returned,
 * because they come back in the same call as the prompts and so cost nothing
 * extra; an output nothing is connected to is simply ignored. What the settings
 * change is how each one is written, not whether it is.
 *
 * Exported for testing — the assembly of these lines is the whole behaviour of
 * the guidance settings, and it is otherwise only observable by mocking the
 * model.
 */
export function buildIdeaInstruction(config: Config): string {
  return [
    'Reply as {"postTitle":string,"caption":string,"hashtags":string[],"additionalOutputs":Record<string,string>,"prompts":[{"title":string,"prompt":string}]}.',
    `Produce exactly ${config.count} entries.`,
    directed(
      'postTitle is a concise, compelling title for the finished social post. It must describe the whole set, not just one image.',
      config.titleGuidance,
    ),
    directed(
      'caption is the post copy itself, written for a social feed and describing the whole set.',
      config.captionGuidance,
    ),
    directed(
      'hashtags are 3 to 8 relevant tags, lowercase, without the # sign.',
      config.hashtagsGuidance,
    ),
    ...(config.additionalOutputs.length
      ? [`Also create these named text fields, each consistent with the same overall concept: ${config.additionalOutputs.map((field) => `${field.id} (${field.label})`).join(', ')}.`]
      : []),
    'title is two or three words, suitable for burning onto a video as a label.',
    'prompt is the full description.',
  ].join(' ');
}

/**
 * Turns a theme into N detailed prompts.
 *
 * The instruction below is the one piece of the original Python pipeline worth
 * keeping (main.py:161-178): it bans vague adjectives and demands a concrete
 * foreground/midground/background, a camera angle and a light source. Prompts
 * written that way produce a set of images that look like one shoot rather than
 * eight unrelated renders, which is what makes the finished video hold together.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const theme = String(ctx.inputs.theme ?? config.theme ?? '').trim();
  if (theme.length < 3) {
    throw new PermanentJobError('Give this step a theme to work from, or connect one to its input.');
  }
  if (!ctx.userId) {
    throw new PermanentJobError('This workflow has no owner to bill AI usage to. Open it and save it again.');
  }

  const system = await buildSystemPrompt({
    workspaceId: ctx.workspaceId,
    extra: INSTRUCTION[config.mode],
  });

  await ctx.assertNotCancelled();
  const { object } = await generateObject({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    operation: 'IDEAS',
    schema: imagePromptsSchema,
    schemaName: 'image_prompts',
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Write ${config.count} ${config.mode} prompts about: ${theme}`,
      },
      { role: 'system', content: buildIdeaInstruction(config) },
    ],
  });

  const suffix = config.styleSuffix.trim();
  const prompts = object.prompts
    .slice(0, config.count)
    .map((p) => (suffix ? `${p.prompt.trim()} ${suffix}` : p.prompt.trim()));

  const additionalOutputs = Object.fromEntries(config.additionalOutputs.map((field) => [
    field.id,
    object.additionalOutputs?.[field.id]?.trim() || object.postTitle.trim(),
  ]));
  return {
    postTitle: object.postTitle.trim(),
    caption: (object.caption ?? '').trim(),
    // One space-separated string rather than a list, because that is what the
    // publish steps' Hashtags input takes and what a person would type there.
    hashtags: (object.hashtags ?? [])
      .map((tag) => tag.trim().replace(/^#+/, ''))
      .filter(Boolean)
      .map((tag) => `#${tag}`)
      .join(' '),
    ...additionalOutputs,
    prompts,
    // Titles ride along so a downstream overlay can label each clip by name.
    titles: object.prompts.slice(0, config.count).map((p) => p.title),
  };
}

const INSTRUCTION: Record<Config['mode'], string> = {
  image: [
    'You are writing prompts for an image generator.',
    'Every prompt must name a concrete foreground, midground and background, a camera angle, a lens, and where the light comes from.',
    'Never use vague adjectives — "beautiful", "stunning", "amazing" carry no information and waste the prompt.',
    'Describe what is physically in the frame, in 120 to 150 words.',
    'Assume a vertical 9:16 frame: keep the subject centred with headroom, because the sides get cropped.',
    'No text, letters, watermarks or signage in the image.',
  ].join(' '),
  video: [
    'You are writing prompts for a video generator.',
    'Describe one continuous shot: what is in frame, how the camera moves, and how the light behaves.',
    'Name the subject, the motion and the duration feel. Avoid cuts — this is a single take.',
    'Assume a vertical 9:16 frame.',
  ].join(' '),
  text: [
    'You are writing short content ideas.',
    'Each title is the hook. Each prompt is the idea, stated concretely in two or three sentences.',
    'No vague claims — name a number, a tool or a consequence.',
  ].join(' '),
};
