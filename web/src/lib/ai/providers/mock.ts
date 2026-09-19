import 'server-only';
import sharp from 'sharp';
import type { z } from 'zod';
import { AiError, type AiImageResult, type AiObjectResult, type AiMessage, type AiProvider, type AiTextResult } from '@/lib/ai/types';
import { weeklyReelTemplate } from '@/lib/workflows/assistant-graph';

/**
 * Deterministic stand-in for a real model.
 *
 * It is keyed on the schema name rather than trying to satisfy an arbitrary Zod
 * type, so what comes back is shaped like real output and is good enough to drive
 * the composer, the assistant and the tests without an API key. Same input, same
 * output — which is what makes the AI paths testable at all.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';
  readonly textModel = 'mock-text-1';
  readonly imageModel = 'mock-image-1';

  isConfigured(): boolean {
    return true;
  }

  async complete(input: { messages: AiMessage[] }): Promise<AiTextResult> {
    const prompt = lastUser(input.messages);
    return {
      text: rewriteDeterministically(prompt),
      model: this.textModel,
      usage: { promptTokens: estimateTokens(prompt), completionTokens: 120, totalTokens: estimateTokens(prompt) + 120 },
    };
  }

  async completeObject<T>(input: {
    messages: AiMessage[];
    schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    schemaName: string;
  }): Promise<AiObjectResult<T>> {
    const prompt = lastUser(input.messages);
    const candidate = build(input.schemaName, prompt, input.messages);
    const parsed = input.schema.safeParse(candidate);
    if (!parsed.success) {
      throw new AiError(
        `The demo AI provider has no sample for "${input.schemaName}". Add one in src/lib/ai/providers/mock.ts, or set AI_PROVIDER=openai.`,
        { cause: parsed.error },
      );
    }
    return {
      object: parsed.data,
      model: this.textModel,
      usage: { promptTokens: estimateTokens(prompt), completionTokens: 200, totalTokens: estimateTokens(prompt) + 200 },
    };
  }

  /** `reference` is accepted and ignored — the placeholder has no layout to follow. */
  async generateImage(input: {
    prompt: string;
    size?: string;
    reference?: { data: Buffer; mimeType: string };
  }): Promise<AiImageResult> {
    const [w, h] = parseSize(input.size);
    return {
      data: await rasterize(placeholderSvg(input.prompt, w, h), w, h),
      mimeType: 'image/png',
      model: this.imageModel,
      usage: {},
    };
  }
}

// ---------------------------------------------------------------- samples

function build(schemaName: string, prompt: string, messages: AiMessage[]): unknown {
  const topic = extractTopic(prompt);
  switch (schemaName) {
    case 'post_draft':
      return { text: draftFor(topic), hashtags: hashtagsFor(topic), firstComment: null };

    case 'post_variations':
      return {
        variations: [
          { label: 'Direct', text: draftFor(topic) },
          { label: 'Question-led', text: `What changes when ${topic} stops being a side project?\n\n${draftFor(topic)}` },
          { label: 'Numbers-first', text: `Three things we measured after moving on ${topic}:\n\n1. Setup time fell from days to hours.\n2. Two people now own what four people used to.\n3. Nothing slipped past review.` },
        ],
      };

    case 'content_ideas':
      return {
        ideas: Array.from({ length: 10 }, (_, i) => ({
          title: `${topic}: angle ${i + 1}`,
          angle: IDEA_ANGLES[i % IDEA_ANGLES.length],
          hook: `${IDEA_ANGLES[i % IDEA_ANGLES.length]} — what most teams get wrong about ${topic}.`,
        })),
      };

    case 'image_prompts': {
      // Varies the descriptor per item so a demo slideshow reads as eight
      // distinct rooms rather than eight copies of one sentence.
      const count = requestedCount(prompt, 'image') ?? 8;
      return {
        postTitle: `${topic} — a set of ${count}`,
        caption: draftFor(topic),
        hashtags: hashtagsFor(topic).map((tag) => tag.replace(/^#/, '')),
        prompts: Array.from({ length: count }, (_, i) => ({
          title: `${IMAGE_STYLES[i % IMAGE_STYLES.length].title}`,
          prompt:
            `${IMAGE_STYLES[i % IMAGE_STYLES.length].detail} ${topic}. ` +
            'Foreground: the main subject, centred with headroom. Midground: furniture and objects that ' +
            'explain the space. Background: a window with daylight falling across the far wall. ' +
            'Shot on a 35mm lens at eye level, natural light, photoreal, vertical composition.',
        })),
      };
    }

    case 'platform_adaptations':
      return {
        versions: [
          { platform: 'LINKEDIN', text: draftFor(topic), hashtags: hashtagsFor(topic).slice(0, 3) },
          { platform: 'X', text: `${shortDraft(topic)}`, hashtags: hashtagsFor(topic).slice(0, 2) },
          { platform: 'INSTAGRAM', text: `${shortDraft(topic)}\n\nFull write-up in the profile link.`, hashtags: hashtagsFor(topic) },
          { platform: 'TIKTOK', text: `${shortDraft(topic)}`, hashtags: hashtagsFor(topic).slice(0, 4) },
          { platform: 'FACEBOOK', text: draftFor(topic), hashtags: hashtagsFor(topic).slice(0, 3) },
          { platform: 'YOUTUBE', text: draftFor(topic), hashtags: hashtagsFor(topic).slice(0, 5) },
        ],
      };

    case 'hashtags':
      return { hashtags: hashtagsFor(topic) };

    case 'brand_voice':
      return {
        tone: 'Professional and conversational',
        personality: 'A competent colleague explaining how the work actually gets done.',
        targetAudience: 'Software engineers and technology executives',
        writingStyle: 'Short declarative sentences. Concrete examples over adjectives. One idea per paragraph.',
        wordsToUse: ['ship', 'measure', 'queue', 'review', 'concrete'],
        wordsToAvoid: ['synergy', 'leverage', 'revolutionary', 'game-changing', 'unlock'],
        emojiPolicy: 'NONE',
        hashtagPolicy: 'MODERATE',
        ctaStyle: 'A plain instruction, never a demand. "Read the write-up" rather than "Don\'t miss this".',
        additionalInstructions: 'Keep LinkedIn posts under 1,500 characters. Prefer a number to an adjective.',
      };

    case 'calendar_plan':
      return {
        posts: Array.from({ length: 8 }, (_, i) => ({
          title: `${topic}: post ${i + 1}`,
          text: draftFor(`${topic} ${i + 1}`),
          hashtags: hashtagsFor(topic).slice(0, 3),
          dayOffset: i * 2,
          hour: 9,
        })),
      };

    case 'assistant_reply':
      {
      const context = workspaceContext(messages);
      const post = referencedPost(prompt, context.posts);
      const campaign = referenced(prompt, context.campaigns, (item) => item.name);
      const asset = referenced(prompt, context.media, (item) => item.filename);
      const prior = priorProposal(messages);
      const simulated = 'This is simulated output. ';
      if (/\bworkflow\b/i.test(prompt)) {
        const workflow = referenced(prompt, context.workflows, (item) => item.name);
        if (/\b(run|start|trigger)\b/i.test(prompt)) {
          if (!workflow) {
            return {
              reply: `${simulated}I could not identify a workflow to run. Name the workflow first.`,
              action: null,
            };
          }
          return {
            reply: `${simulated}I prepared a run for "${workflow.name}". Review it before starting because its steps may use AI quota or publish content.`,
            action: {
              kind: 'run_workflow',
              summary: `Run "${workflow.name}"`,
              workflowId: workflow.id,
              workflowName: workflow.name,
            },
          };
        }
        if (/\b(update|rename|reschedule|change)\b/i.test(prompt) && workflow) {
          const { hour, minute } = requestedTime(prompt);
          return {
            reply: `${simulated}I prepared an update for "${workflow.name}". Nothing will change until you confirm.`,
            action: {
              kind: 'update_workflow',
              summary: `Update "${workflow.name}"`,
              workflowId: workflow.id,
              workflowName: workflow.name,
              scheduleEnabled: true,
              scheduleWeekdays: requestedWeekdays(prompt),
              scheduleHour: hour,
              scheduleMinute: minute,
              nodeUpdates: [],
            },
          };
        }
        const pool = requestedThemePool(prompt);
        const graph = weeklyReelTemplate(topic, pool);
        const { hour, minute } = requestedTime(prompt);
        return {
          reply: pool.length
            ? `${simulated}I prepared a reel workflow that draws one of ${pool.length} subjects at random each run. Nothing will be created until you confirm.`
            : `${simulated}I prepared a weekly reel workflow for ${topic}. Nothing will be created until you confirm.`,
          action: {
            kind: 'create_workflow',
            summary: `Create "${graph.name}"`,
            name: graph.name,
            description: graph.description,
            scheduleEnabled: /\b(weekly|schedule|every)\b/i.test(prompt),
            scheduleWeekdays: requestedWeekdays(prompt),
            scheduleHour: hour,
            scheduleMinute: minute,
            nodes: graph.nodes,
            edges: graph.edges,
          },
        };
      }
      if (/\b(schedule|queue|move|reschedule|re-date|change the date)\b/i.test(prompt)) {
        if (!post) return { reply: `${simulated}I could not identify an existing post to schedule, so I did not prepare a proposal. Name the post you want to schedule.`, action: null };
        const posts = selectRequestedPosts(prompt, context.posts, post);
        const { hour, minute } = requestedTime(prompt);
        return {
          reply: `${simulated}I prepared a schedule proposal for ${posts.length === 1 ? `"${posts[0].title}"` : `${posts.length} posts`}. Nothing will change until you confirm.`,
          action: {
            kind: 'schedule_posts',
            summary: `Schedule ${posts.length === 1 ? `"${posts[0].title}"` : `${posts.length} posts`}`,
            posts: posts.map((item) => ({ postId: item.id, postTitle: item.title })),
            weekdays: requestedWeekdays(prompt),
            hour,
            minute,
          },
        };
      }
      if (/\b(assign|add|put|link)\b.*\bcampaign\b|\bcampaign\b.*\b(assign|add|put|link)\b/i.test(prompt)) {
        if (!post || !campaign) return { reply: `${simulated}I could not identify both an existing post and campaign, so I did not prepare a proposal. Name both of them.`, action: null };
        return {
          reply: `${simulated}I prepared a proposal to assign "${post.title}" to "${campaign.name}". Nothing will change until you confirm.`,
          action: {
            kind: 'assign_campaign',
            summary: `Assign "${post.title}" to "${campaign.name}"`,
            postId: post.id,
            postTitle: post.title,
            campaignId: campaign.id,
            campaignName: campaign.name,
          },
        };
      }
      if (/\b(attach|add)\b.*\b(media|image|asset|video|file)\b/i.test(prompt)) {
        if (!post || !asset) return { reply: `${simulated}I could not identify both an existing post and ready media file, so I did not prepare a proposal. Name both of them.`, action: null };
        return {
          reply: `${simulated}I prepared a proposal to attach the selected media asset to "${post.title}" on every channel version. Nothing will change until you confirm.`,
          action: {
            kind: 'attach_media',
            summary: `Attach the selected media asset to "${post.title}"`,
            postId: post.id,
            postTitle: post.title,
            media: [{ mediaAssetId: asset.id, filename: asset.filename, altText: `Media for ${post.title}` }],
          },
        };
      }
      if (/\b(repurpose|adapt)\b/i.test(prompt)) {
        if (!post) return { reply: `${simulated}I could not identify an existing source post, so I did not prepare a proposal. Name the post you want to repurpose.`, action: null };
        return {
          reply: `${simulated}I prepared a new draft based on "${post.title}". The original will remain unchanged, and nothing will be created until you confirm.`,
          action: {
            kind: 'repurpose_content',
            summary: `Create a repurposed draft from "${post.title}"`,
            sourcePostId: post.id,
            sourcePostTitle: post.title,
            newTitle: `${post.title} — repurposed`,
            text: draftFor(`${post.title} for a fresh audience`),
            hashtags: hashtagsFor(post.title),
          },
        };
      }
      if (
        /\b(update|rewrite|shorten|expand|tone|technical|hashtags?|call to action|cta)\b/i.test(prompt)
        && prior?.kind === 'create_drafts'
      ) {
        const refined = prior.posts.map((draft, index) => {
          const text = /\bshorten\b/i.test(prompt)
            ? shortDraft(draft.title || topic)
            : /\b(call to action|cta)\b/i.test(prompt)
              ? `${draft.text}\n\nRead the full release notes.`
              : draftFor(`${draft.title || topic}, ${/\btechnical\b/i.test(prompt) ? 'with implementation details' : 'refined'}`);
          return {
            title: draft.title || `Refined draft ${index + 1}`,
            text,
            hashtags: /\bhashtags?\b/i.test(prompt) ? hashtagsFor(draft.title || topic) : draft.hashtags,
          };
        });
        return {
          reply: `${simulated}I prepared a refined version of the previous ${refined.length === 1 ? 'draft' : 'drafts'}. The earlier proposal remains unchanged; confirm only the version you want to create.`,
          action: {
            kind: 'create_drafts',
            summary: `Create ${refined.length === 1 ? 'the refined draft' : `${refined.length} refined drafts`}`,
            posts: refined,
          },
        };
      }
      if (/\b(update|rewrite|shorten|expand|tone|technical|hashtags?|call to action|cta)\b/i.test(prompt) && post) {
        const text = /\bshorten\b/i.test(prompt) ? shortDraft(post.title) : draftFor(`${post.title}, revised`);
        return {
          reply: `${simulated}I prepared revised copy for "${post.title}" across every channel version. Nothing will change until you confirm.`,
          action: {
            kind: 'update_post_content',
            summary: `Update the copy for "${post.title}"`,
            postId: post.id,
            postTitle: post.title,
            text,
            hashtags: hashtagsFor(post.title),
          },
        };
      }
      if (/\b(create|draft|post)\b/i.test(prompt)) {
        const count = Math.min(requestedCount(prompt, 'post') ?? 1, 10);
        return {
          reply: `${simulated}I prepared ${count === 1 ? 'a draft' : `${count} distinct drafts`} for ${topic}. Confirm the proposed action to add ${count === 1 ? 'it' : 'them'} to the workspace.`,
          action: {
            kind: 'create_drafts',
            summary: `Create ${count === 1 ? 'one draft' : `${count} drafts`} about ${topic}`,
            posts: Array.from({ length: count }, (_, index) => ({
              title: count === 1 ? `${topic}: draft` : `${topic}: draft ${index + 1}`,
              text: draftFor(count === 1 ? topic : `${topic} — angle ${index + 1}`),
              hashtags: hashtagsFor(topic),
            })),
          },
        };
      }
      return {
        reply: `${simulated}Here is a plan for ${topic}. Ask me to create drafts or name an existing workspace item when you want a structured action; nothing is written until you confirm.`,
        action: null,
      };
      }

    default:
      return null;
  }
}

type WorkspaceContext = {
  posts: Array<{
    id: string;
    title: string;
    status: string;
    scheduledAt?: string | null;
    platforms?: string[];
  }>;
  campaigns: Array<{ id: string; name: string }>;
  media: Array<{ id: string; filename: string; type: string }>;
  workflows: Array<{ id: string; name: string }>;
};

function workspaceContext(messages: AiMessage[]): WorkspaceContext {
  const empty = { posts: [], campaigns: [], media: [], workflows: [] };
  const combined = messages.map((message) => message.content).join('\n');
  const match = combined.match(/WORKSPACE_CONTEXT_BEGIN([\s\S]*?)WORKSPACE_CONTEXT_END/);
  if (!match) return empty;
  try {
    return { ...empty, ...JSON.parse(match[1]) } as WorkspaceContext;
  } catch {
    return empty;
  }
}

function referenced<T>(prompt: string, values: T[], label: (value: T) => string): T | undefined {
  const normalized = prompt.toLowerCase();
  return values.find((value) => normalized.includes(label(value).toLowerCase())) ?? values[0];
}

function referencedPost(prompt: string, posts: WorkspaceContext['posts']) {
  const normalized = prompt.toLowerCase();
  const named = posts.find((post) => normalized.includes(post.title.toLowerCase()));
  if (named) return named;
  let candidates = posts;
  const platform = ['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'X', 'TIKTOK', 'YOUTUBE']
    .find((value) => new RegExp(`\\b${value}\\b`, 'i').test(prompt));
  if (platform) candidates = candidates.filter((post) => post.platforms?.includes(platform));
  if (/\btomorrow\b/i.test(prompt)) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    candidates = candidates.filter((post) => {
      if (!post.scheduledAt) return false;
      const date = new Date(post.scheduledAt);
      return date.getUTCFullYear() === tomorrow.getUTCFullYear()
        && date.getUTCMonth() === tomorrow.getUTCMonth()
        && date.getUTCDate() === tomorrow.getUTCDate();
    });
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function priorProposal(messages: AiMessage[]): {
  kind: 'create_drafts';
  posts: Array<{ title?: string; text: string; hashtags: string[] }>;
} | null {
  for (const message of [...messages].reverse()) {
    const match = message.content.match(/<prior_proposal>([\s\S]*?)<\/prior_proposal>/);
    if (!match) continue;
    try {
      const value = JSON.parse(match[1]);
      if (value?.kind === 'create_drafts' && Array.isArray(value.posts)) return value;
    } catch {
      return null;
    }
  }
  return null;
}

function selectRequestedPosts(
  prompt: string,
  posts: WorkspaceContext['posts'],
  fallback: WorkspaceContext['posts'][number],
) {
  const count = Math.min(requestedCount(prompt, 'post') ?? 1, posts.length);
  if (count <= 1) return [fallback];
  return [fallback, ...posts.filter((post) => post.id !== fallback.id)].slice(0, count);
}

const COUNT_NOUNS: Record<'post' | 'image', string> = {
  post: 'drafts?|posts?',
  image: 'images?|prompts?|photos?|shots?|rooms?|options?',
};

function requestedCount(prompt: string, noun: 'post' | 'image'): number | null {
  const nouns = COUNT_NOUNS[noun];
  const numeric = prompt.match(new RegExp(`\\b(\\d{1,2})[ -]?(?:distinct\\s+)?(?:${nouns})\\b`, 'i'));
  if (numeric) return Number(numeric[1]);
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  const written = prompt.match(
    new RegExp(`\\b(one|two|three|four|five|six|seven|eight|nine|ten)[ -]?(?:distinct\\s+)?(?:${nouns})\\b`, 'i'),
  );
  return written ? words[written[1].toLowerCase()] : null;
}

function requestedWeekdays(prompt: string): number[] {
  const names: Array<[RegExp, number]> = [
    [/\bsun(?:day)?s?\b/i, 0],
    [/\bmon(?:day)?s?\b/i, 1],
    [/\btue(?:sday)?s?\b/i, 2],
    [/\bwed(?:nesday)?s?\b/i, 3],
    [/\bthu(?:rsday)?s?\b/i, 4],
    [/\bfri(?:day)?s?\b/i, 5],
    [/\bsat(?:urday)?s?\b/i, 6],
  ];
  const selected = names.filter(([pattern]) => pattern.test(prompt)).map(([, day]) => day);
  return selected.length ? selected : [1, 3, 5];
}

function requestedTime(prompt: string): { hour: number; minute: number } {
  const match = prompt.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return { hour: 9, minute: 0 };
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (match[3]?.toLowerCase() === 'pm' && hour < 12) hour += 12;
  if (match[3]?.toLowerCase() === 'am' && hour === 12) hour = 0;
  return hour <= 23 && minute <= 59 ? { hour, minute } : { hour: 9, minute: 0 };
}

const IMAGE_STYLES = [
  { title: 'Warm minimal', detail: 'A warm minimalist take on' },
  { title: 'Coastal', detail: 'A bright coastal interpretation of' },
  { title: 'Dark academia', detail: 'A moody, book-lined version of' },
  { title: 'Mid-century', detail: 'A mid-century modern rendering of' },
  { title: 'Japandi', detail: 'A quiet Japandi treatment of' },
  { title: 'Industrial', detail: 'A raw industrial composition of' },
  { title: 'Maximal colour', detail: 'A saturated, pattern-heavy vision of' },
  { title: 'Scandi', detail: 'A pale Scandinavian arrangement of' },
];

const IDEA_ANGLES = [
  'Contrarian take',
  'Behind the build',
  'Numbers from the last quarter',
  'A mistake worth naming',
  'Tooling teardown',
  'Before and after',
  'Question to the room',
  'One-paragraph explainer',
];

function draftFor(topic: string): string {
  return [
    `Most teams treat ${topic} as a thing they will get to.`,
    '',
    `The teams that get value out of it do one unglamorous thing first: they write down what "done" means, then measure against it. Everything after that is scheduling.`,
    '',
    'Worth twenty minutes this week.',
  ].join('\n');
}

function shortDraft(topic: string): string {
  return `${topic} works once you define "done" and measure against it. Everything after that is scheduling.`;
}

function hashtagsFor(topic: string): string[] {
  const slug = topic.replace(/[^a-zA-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2);
  return [...slug.map((w) => `#${w.toLowerCase()}`), '#buildinpublic', '#engineering', '#automation'].slice(0, 5);
}

/**
 * Subjects for a workflow asked to vary what it posts about.
 *
 * The simulated provider invents nothing, so it reads the subjects out of the
 * request — the ones listed after "like" or "such as", or the request itself
 * when none are listed. Real output comes from the model.
 */
function requestedThemePool(prompt: string): string[] {
  if (!/\b(random|randomly|varied|vary|varying|rotate|rotating|different topics|different themes|not repeat|no repeats)\b/i.test(prompt)) {
    return [];
  }
  const listed = prompt.match(/\b(?:like|such as|including)\s+(.{3,200}?)(?:[.?!\n]|$)/i);
  const entries = (listed?.[1] ?? '')
    .split(/,| and |\betc\b/i)
    .map((entry) => entry.trim().replace(/[.\s]+$/, ''))
    .filter((entry) => entry.length > 2)
    .slice(0, 8);
  return entries.length ? entries : [extractTopic(prompt)];
}

function extractTopic(prompt: string): string {
  const match = prompt.match(/about:?\s+(.{3,60}?)(?:[.?!\n]|$)/i);
  if (match) return match[1].trim();
  const words = prompt.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  return words || 'the work';
}

function rewriteDeterministically(prompt: string): string {
  return `${prompt.trim().replace(/\s+/g, ' ').slice(0, 400)}\n\nWritten by the demo AI provider. Set AI_PROVIDER=openai and add OPENAI_API_KEY for real generations.`;
}

function lastUser(messages: AiMessage[]): string {
  return [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * A labelled placeholder, in the design system's own idiom — a pastel ground with
 * a mono caption naming what belongs there. Never a fake photograph.
 */
function placeholderSvg(prompt: string, width: number, height: number): string {
  const caption = prompt.toUpperCase().replace(/[<>&]/g, '').slice(0, 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#c8e6cd"/>
  <text x="50%" y="48%" text-anchor="middle" font-family="ui-monospace, monospace" font-size="${Math.round(width / 34)}" letter-spacing="1.2" fill="#000">${caption}</text>
  <text x="50%" y="56%" text-anchor="middle" font-family="ui-monospace, monospace" font-size="${Math.round(width / 46)}" letter-spacing="1.2" fill="#000" opacity="0.55">GENERATED PLACEHOLDER · ${width}×${height}</text>
</svg>`;
}

function parseSize(size: string | undefined): [number, number] {
  const [w, h] = (size ?? '1024x1024').split('x').map(Number);
  return [Number.isFinite(w) && w > 0 ? w : 1024, Number.isFinite(h) && h > 0 ? h : 1024];
}

/**
 * Every platform rejects SVG uploads, so the placeholder leaves here as a PNG.
 * A sharp build without SVG text support still owes us a valid image, hence the
 * flat pastel ground as a fallback.
 */
async function rasterize(svg: string, width: number, height: number): Promise<Buffer> {
  try {
    return await sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
  } catch {
    return sharp({ create: { width, height, channels: 3, background: '#c8e6cd' } }).png().toBuffer();
  }
}
