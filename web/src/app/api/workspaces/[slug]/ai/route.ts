import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/guard';
import {
  adaptPlatforms,
  generateCalendar,
  generateHashtags,
  generateIdeas,
  generatePost,
  generateVariations,
} from '@/lib/ai/service';
import { generateStudioImageAction } from '@/app/actions/ai';
import { toAppError } from '@/lib/errors';
import { rateLimit, LIMITS } from '@/lib/rate-limit';

const writingOperations = ['generate', 'rewrite', 'shorten', 'expand', 'professional', 'casual', 'hook', 'cta'] as const;
const schema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('ideas'), prompt: z.string().min(3).max(5_000) }),
  ...writingOperations.map((operation) => z.object({
    operation: z.literal(operation),
    prompt: z.string().min(3).max(20_000),
    platform: z.enum(['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'X', 'TIKTOK', 'YOUTUBE']).optional(),
  })),
  z.object({ operation: z.literal('hashtags'), prompt: z.string().min(3).max(20_000) }),
  z.object({ operation: z.literal('variations'), prompt: z.string().min(3).max(20_000) }),
  z.object({ operation: z.literal('calendar'), prompt: z.string().min(3).max(5_000) }),
  z.object({
    operation: z.literal('image'),
    prompt: z.string().min(3).max(5_000),
    size: z.enum(['1024x1024', '1024x1536', '1536x1024']).optional(),
  }),
  z.object({
    operation: z.literal('adapt'),
    prompt: z.string().min(3).max(20_000),
    platforms: z.array(z.enum(['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'X', 'TIKTOK', 'YOUTUBE'])).min(1),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const ctx = await requireWorkspace(slug, 'ai:use');
    const limit = await rateLimit(`ai:${ctx.user.id}`, LIMITS.aiGeneration.limit, LIMITS.aiGeneration.window);
    if (!limit.allowed) return NextResponse.json({ error: 'Too many AI requests. Wait a minute and try again.' }, { status: 429 });
    const input = schema.parse(await request.json());
    const common = { workspaceId: ctx.workspace.id, userId: ctx.user.id };
    const result =
      input.operation === 'ideas'
        ? await generateIdeas({ ...common, prompt: input.prompt })
        : input.operation === 'calendar'
          ? await generateCalendar({ ...common, prompt: input.prompt })
        : input.operation === 'image'
          ? await generateStudioImageAction(slug, { prompt: input.prompt, size: input.size })
        : input.operation === 'adapt'
          ? await adaptPlatforms({ ...common, text: input.prompt, platforms: input.platforms })
          : input.operation === 'hashtags'
            ? await generateHashtags({ ...common, text: input.prompt })
            : input.operation === 'variations'
              ? await generateVariations({ ...common, text: input.prompt })
              : await generatePost({
                  ...common,
                  prompt: input.prompt,
                  platform: input.platform,
                  operation: input.operation,
                });
    return NextResponse.json({ data: result });
  } catch (error) {
    const appError = toAppError(error);
    console.error('[api/ai]', appError.detail ?? error);
    return NextResponse.json({ error: appError.message, fields: appError.fields }, { status: appError.status });
  }
}
