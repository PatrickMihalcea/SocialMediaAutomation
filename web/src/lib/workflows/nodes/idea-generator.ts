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
      {
        role: 'system',
        content:
          'Reply as {"prompts":[{"title":string,"prompt":string}]}. ' +
          `Produce exactly ${config.count} entries. ` +
          'title is two or three words, suitable for burning onto a video as a label. ' +
          'prompt is the full description.',
      },
    ],
  });

  const suffix = config.styleSuffix.trim();
  const prompts = object.prompts
    .slice(0, config.count)
    .map((p) => (suffix ? `${p.prompt.trim()} ${suffix}` : p.prompt.trim()));

  return {
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
