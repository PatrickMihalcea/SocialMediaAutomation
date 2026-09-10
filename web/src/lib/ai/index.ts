import 'server-only';
import type { AiOperation } from '@prisma/client';
import type { z } from 'zod';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { OpenAiProvider } from '@/lib/ai/providers/openai';
import { MockAiProvider } from '@/lib/ai/providers/mock';
import type { AiImageResult, AiMessage, AiObjectResult, AiProvider } from '@/lib/ai/types';
import { assertWithinLimit, currentMonthUsage, incrementUsage } from '@/lib/billing/limits';

let providerInstance: AiProvider | null = null;

export function aiProvider(): AiProvider {
  if (!providerInstance) {
    providerInstance = env.AI_PROVIDER === 'openai' ? new OpenAiProvider() : new MockAiProvider();
  }
  return providerInstance;
}

export async function generateObject<T>(input: {
  workspaceId: string;
  userId: string;
  operation: AiOperation;
  messages: AiMessage[];
  schema: z.ZodType<T>;
  schemaName: string;
  temperature?: number;
}): Promise<AiObjectResult<T>> {
  const used = await currentMonthUsage(input.workspaceId, 'ai_generations');
  await assertWithinLimit(input.workspaceId, 'aiGenerations', used);

  const provider = aiProvider();
  try {
    const result = await provider.completeObject(input);
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
  size?: '1024x1024' | '1024x1536' | '1536x1024';
}): Promise<AiImageResult & { generationId: string }> {
  const used = await currentMonthUsage(input.workspaceId, 'ai_generations');
  await assertWithinLimit(input.workspaceId, 'aiGenerations', used);
  const provider = aiProvider();
  try {
    const result = await provider.generateImage({ prompt: input.prompt, size: input.size });
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
