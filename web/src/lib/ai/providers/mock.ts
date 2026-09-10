import 'server-only';
import sharp from 'sharp';
import type { z } from 'zod';
import { AiError, type AiImageResult, type AiObjectResult, type AiMessage, type AiProvider, type AiTextResult } from '@/lib/ai/types';

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
    schema: z.ZodType<T>;
    schemaName: string;
  }): Promise<AiObjectResult<T>> {
    const prompt = lastUser(input.messages);
    const candidate = build(input.schemaName, prompt);
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

  async generateImage(input: { prompt: string; size?: string }): Promise<AiImageResult> {
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

function build(schemaName: string, prompt: string): unknown {
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
      if (/\b(create|draft|post)\b/i.test(prompt)) {
        return {
          reply: `I prepared a draft for ${topic}. Confirm the proposed action to add it to the workspace.`,
          action: {
            kind: 'create_drafts',
            summary: `Create one draft about ${topic}`,
            posts: [{ title: `${topic}: draft`, text: draftFor(topic), hashtags: hashtagsFor(topic) }],
          },
        };
      }
      return {
        reply: `Here is a plan for ${topic}. Ask me to create drafts when you want a structured action; nothing is written until you confirm.`,
        action: null,
      };

    default:
      return null;
  }
}

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

function extractTopic(prompt: string): string {
  const match = prompt.match(/about\s+(.{3,60}?)(?:[.?!\n]|$)/i);
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
