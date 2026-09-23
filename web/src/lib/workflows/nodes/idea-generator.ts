import 'server-only';
import { WorkflowNodeRunStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { generateObject } from '@/lib/ai';
import { buildSystemPrompt } from '@/lib/ai/brand-voice';
import { imagePromptsSchema } from '@/lib/ai/schemas';
import { PermanentJobError } from '@/lib/queue/runner';
import type { NodeRunContext } from '@/lib/workflows/node-context';

interface Config {
  mode: 'image' | 'text' | 'video';
  themeMode: 'fixed' | 'random';
  theme: string;
  themePool: string[];
  themeImages: Record<string, string>;
  count: number;
  promptGuidance: string;
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
export function buildIdeaInstruction(config: Config, recentTitles: string[] = []): string {
  return [
    'Reply as {"postTitle":string,"caption":string,"hashtags":string[],"additionalOutputs":Record<string,string>,"prompts":[{"title":string,"prompt":string}]}.',
    `Produce exactly ${config.count} entries.`,
    // The model has no memory between runs, so a step left on the same theme
    // writes near enough the same set every week. Naming what it already
    // covered is the cheapest way to keep a feed from repeating itself.
    ...(recentTitles.length
      ? [`This step has already covered these angles, so take a different one for every entry: ${recentTitles.join('; ')}.`]
      : []),
    directed(
      'postTitle is a concise, compelling title for the finished social post. It must describe the whole set, not just one image.',
      config.titleGuidance,
    ),
    directed(
      'caption is the post copy itself, written for a social feed.',
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
    directed('prompt is the full description.', config.promptGuidance),
  ].join(' ');
}

/**
 * Turns a theme into N detailed prompts.
 *
 * INSTRUCTION below is what makes a set of images read as one shoot rather than
 * eight unrelated renders: it fixes the depth structure and the finish, and
 * leaves the subject, mood and materials to the theme. Deliberately written as
 * direction rather than a checklist of required nouns — naming the hierarchy
 * and the look, then explicitly allowing creative interpretation, gives a set
 * that varies without drifting. It names no subject matter of its own, so a
 * theme pool can range from interiors to landscapes without fighting it.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const history = await recentRuns(ctx);
  const theme = resolveTheme(config, ctx.inputs.theme);
  if (theme.length < 3) {
    throw new PermanentJobError(
      config.themeMode === 'random'
        ? 'This step draws its theme at random but its theme pool is empty. Add some themes to it.'
        : 'Give this step a theme to work from, or connect one to its input.',
    );
  }
  if (!ctx.userId) {
    throw new PermanentJobError('This workflow has no owner to bill AI usage to. Open it and save it again.');
  }
  const recentTitles = coveredTitles(history, theme);

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
      { role: 'system', content: buildIdeaInstruction(config, recentTitles) },
    ],
  });

  const prompts = object.prompts.slice(0, config.count).map((p) => p.prompt.trim());

  const additionalOutputs = Object.fromEntries(config.additionalOutputs.map((field) => [
    field.id,
    object.additionalOutputs?.[field.id]?.trim() || object.postTitle.trim(),
  ]));
  return {
    // Emitted as well as used: a random theme that only lived inside this run
    // could not be shown on the video, written into the caption, or read back
    // by the next run deciding what not to repeat.
    theme,
    // The sketch paired with whichever theme was drawn.
    //
    // Recorded in the output but not declared as a port: it reaches the Image
    // generator by riding along with the prompts, so a connector for it would
    // be one nothing can be plugged into. The ride-along reads this value off
    // the upstream run's output, which is why it still has to be written here.
    reference: config.themeImages[theme] ?? null,
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

/**
 * The theme this run works from.
 *
 * Three sources, most specific first: a connected input beats everything, a
 * random draw comes next, and the typed theme is the fallback.
 *
 * The draw is uniform over the whole pool, every run. It used to exclude the
 * themes the step had most recently used, which made the sequence a shuffle
 * rather than a draw — with a pool of four, the next theme was picked from
 * three and the one just used could not come up at all. That is a cycle wearing
 * randomness as a hat, and it is not what "random from a pool" says. Repeats
 * are a property of drawing at random, not a bug in it.
 *
 * Runs still avoid repeating *ideas*: the recent titles for the drawn theme are
 * named in the instruction, so landing on the same theme twice produces
 * different angles rather than the same post.
 */
export function resolveTheme(
  config: Pick<Config, 'themeMode' | 'theme' | 'themePool'>,
  connected: unknown,
  random: () => number = Math.random,
): string {
  const wired = String(connected ?? '').trim();
  if (wired) return wired;
  if (config.themeMode !== 'random') return String(config.theme ?? '').trim();

  const pool = [...new Set((config.themePool ?? []).map((entry) => entry.trim()).filter(Boolean))];
  if (pool.length === 0) return '';
  // Clamped because a random() of exactly 1 would index past the end. Math
  // .random never returns it, but this is also the seam the tests drive.
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** Themes and titles this step produced before, newest first. */
async function recentRuns(ctx: NodeRunContext): Promise<Array<{ theme: string; titles: string[] }>> {
  const runs = await db.workflowNodeRun.findMany({
    where: {
      nodeId: ctx.nodeId,
      workspaceId: ctx.workspaceId,
      status: WorkflowNodeRunStatus.SUCCEEDED,
      id: { not: ctx.nodeRunId },
    },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: { output: true },
  });
  return runs.map((run) => {
    const output = (run.output ?? {}) as { theme?: unknown; titles?: unknown; postTitle?: unknown };
    return {
      theme: typeof output.theme === 'string' ? output.theme.trim() : '',
      titles: [
        ...(Array.isArray(output.titles) ? output.titles : []),
        output.postTitle,
      ].filter((title): title is string => typeof title === 'string' && title.trim() !== ''),
    };
  });
}

/**
 * What to tell the model it has already made — only for the theme in hand,
 * because titles written for a different topic say nothing about this one.
 */
function coveredTitles(history: Array<{ theme: string; titles: string[] }>, theme: string): string[] {
  return [
    ...new Set(
      history
        .filter((entry) => !entry.theme || entry.theme === theme)
        .flatMap((entry) => entry.titles)
        .map((title) => title.trim()),
    ),
  ].slice(0, 40);
}

const INSTRUCTION: Record<Config['mode'], string> = {
  image: [
    'Create a visually compelling scene with a strong sense of depth and atmosphere. Describe the subject of the theme as the main focus, then naturally establish the foreground, surrounding environment, background, and distant views. Include details such as terrain, sky, weather, vegetation, nearby structures, surfaces, reflections, furnishings, and other environmental elements when appropriate to the concept.',
    'Use the theme to determine the mood, time of day, lighting, colors, materials, and environment. Build a clear visual hierarchy with an interesting foreground, a strong focal point, and a visually rich background. Avoid overly specific constraints that limit creativity.',
    'Describe the scene, not the medium. The rendering style — photographic, illustrated, pixel art, or anything else — is set on the Image generator and applied to every prompt, so do not name a medium, a finish, or a frame shape here. No text, logos, or watermarks in the image.',
  ].join('\n\n'),
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
