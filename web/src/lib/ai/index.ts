import 'server-only';
import type { AiOperation } from '@prisma/client';
import type { z } from 'zod';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { OpenAiProvider } from '@/lib/ai/providers/openai';
import { MockAiProvider } from '@/lib/ai/providers/mock';
import { ImageUseProvider } from '@/lib/ai/providers/image-use';
import { resolveImageProviderName, type ImageProviderName } from '@/lib/ai/provider-selection';
import type { AiImageResult, AiMessage, AiObjectResult, AiProvider } from '@/lib/ai/types';
import type { ImageSize } from '@/lib/ai/image-sizes';
import { assertWithinLimit, currentMonthUsage, incrementUsage } from '@/lib/billing/limits';

let providerInstance: AiProvider | null = null;
const imageProviderInstances = new Map<ImageProviderName, AiProvider>();

export function aiProvider(): AiProvider {
  if (!providerInstance) {
    providerInstance = env.AI_PROVIDER === 'openai' ? new OpenAiProvider() : new MockAiProvider();
  }
  return providerInstance;
}

/**
 * Image generation is choosable per call, not just per deployment.
 *
 * The three sources cost and behave differently enough that the choice belongs
 * to whoever is asking: the mock is free and instant, the OpenAI API is billed
 * per image and returns in seconds, and image-use spends a subscription and can
 * take a minute. A studio user picking between them, and a workflow step pinned
 * to one, both pass an override here; everything else gets what the deployment
 * is configured for.
 */
export function imageProvider(override?: ImageProviderName): AiProvider {
  const selected = override ?? resolveImageProviderName(env.AI_PROVIDER, env.AI_IMAGE_PROVIDER);
  if (!override && selected === env.AI_PROVIDER) return aiProvider();
  const existing = imageProviderInstances.get(selected);
  if (existing) return existing;
  const created =
    selected === 'openai'
      ? new OpenAiProvider()
      : selected === 'image-use'
        ? new ImageUseProvider()
        : new MockAiProvider();
  imageProviderInstances.set(selected, created);
  return created;
}

/**
 * Whether image generation can happen inside *this* process.
 *
 * image-use is a local CLI, so the answer depends on where the code is running
 * rather than on configuration alone: the worker has the binary, a serverless
 * web tier never will. A caller that can queue instead of blocking — the studio
 * — asks this first, so the request lands on the machine that can serve it
 * rather than failing on the one that cannot.
 */
export function imageGenerationRunsInProcess(provider?: ImageProviderName): boolean {
  const selected = provider ?? resolveImageProviderName(env.AI_PROVIDER, env.AI_IMAGE_PROVIDER);
  return selected !== 'image-use' || new ImageUseProvider().isConfigured();
}

export const MIN_AI_TEMPERATURE = 0;
export const MAX_AI_TEMPERATURE = 1.3;

/**
 * The temperature a workspace generates at.
 *
 * A number the workspace sets, not one of three names standing in for one:
 * three fixed points were never the right three for everybody, and the whole
 * effect of the setting is how far up this scale you are.
 *
 * Falls back to the old three-way setting for a row written before the number
 * existed, so nothing silently changes what it was already doing.
 *
 * Clamped rather than trusted. This is read straight out of the database and
 * handed to the provider, and a number outside the range it accepts fails the
 * call rather than the validation.
 */
export function resolveTemperature(preferences: {
  aiTemperature?: number | null;
  aiCreativity?: 'PRECISE' | 'BALANCED' | 'CREATIVE' | null;
} | null): number {
  const chosen = preferences?.aiTemperature
    ?? LEGACY_TEMPERATURES[preferences?.aiCreativity ?? 'BALANCED'];
  if (!Number.isFinite(chosen)) return LEGACY_TEMPERATURES.BALANCED;
  return Math.min(MAX_AI_TEMPERATURE, Math.max(MIN_AI_TEMPERATURE, chosen));
}

/** What each of the three old names meant, kept only to read those rows. */
const LEGACY_TEMPERATURES: Record<'PRECISE' | 'BALANCED' | 'CREATIVE', number> = {
  PRECISE: 0.25,
  BALANCED: 0.7,
  CREATIVE: 1,
};

export async function generateObject<T>(input: {
  workspaceId: string;
  userId: string;
  operation: AiOperation;
  messages: AiMessage[];
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  schemaName: string;
  temperature?: number;
}): Promise<AiObjectResult<T>> {
  const used = await currentMonthUsage(input.workspaceId, 'ai_generations');
  await assertWithinLimit(input.workspaceId, 'aiGenerations', used);

  const provider = aiProvider();
  const preferences = await db.workspacePreferences.findUnique({
    where: { workspaceId: input.workspaceId },
    select: { aiTemperature: true, aiCreativity: true },
  });
  const temperature = input.temperature ?? resolveTemperature(preferences);
  try {
    const result = await provider.completeObject({ ...input, temperature });
    await Promise.all([
      incrementUsage(input.workspaceId, 'ai_generations'),
      recordGeneration({
        ...input,
        provider: provider.name,
        model: result.model,
        usage: result.usage,
        succeeded: true,
      }),
    ]);
    return result;
  } catch (error) {
    await recordGeneration({
      ...input,
      provider: provider.name,
      model: provider.textModel,
      usage: {},
      succeeded: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function generateImage(input: {
  workspaceId: string;
  userId: string;
  prompt: string;
  size?: ImageSize;
  /** Advisory layout for providers that can follow one; see AiProvider. */
  reference?: { data: Buffer; mimeType: string };
  /** Per-call choice of source; omitted means the deployment's configured one. */
  provider?: ImageProviderName;
}): Promise<AiImageResult & { generationId: string }> {
  const used = await currentMonthUsage(input.workspaceId, 'ai_generations');
  await assertWithinLimit(input.workspaceId, 'aiGenerations', used);
  const provider = imageProvider(input.provider);
  try {
    const result = await provider.generateImage({
      prompt: input.prompt,
      size: input.size,
      reference: input.reference,
    });
    const generation = await recordGeneration({
      workspaceId: input.workspaceId,
      userId: input.userId,
      operation: 'IMAGE',
      provider: provider.name,
      model: result.model,
      usage: result.usage,
      succeeded: true,
    });
    await incrementUsage(input.workspaceId, 'ai_generations');
    return { ...result, generationId: generation.id };
  } catch (error) {
    await recordGeneration({
      workspaceId: input.workspaceId,
      userId: input.userId,
      operation: 'IMAGE',
      provider: provider.name,
      model: provider.imageModel,
      usage: {},
      succeeded: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function recordGeneration(input: {
  workspaceId: string;
  userId: string;
  operation: AiOperation;
  provider: string;
  model: string;
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  succeeded: boolean;
  errorMessage?: string;
}) {
  const cost = estimateCost(input.model, input.usage.promptTokens, input.usage.completionTokens);
  return db.aiGeneration.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      operation: input.operation,
      provider: input.provider,
      model: input.model,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      totalTokens: input.usage.totalTokens,
      estimatedCost: cost,
      succeeded: input.succeeded,
      errorMessage: input.errorMessage,
    },
  });
}

function estimateCost(
  model: string,
  promptTokens?: number,
  completionTokens?: number,
): number | null {
  if (!promptTokens && !completionTokens) return null;
  const rates = model.includes('gpt-4o-mini')
    ? { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 }
    : { input: 5 / 1_000_000, output: 15 / 1_000_000 };
  return (promptTokens ?? 0) * rates.input + (completionTokens ?? 0) * rates.output;
}
