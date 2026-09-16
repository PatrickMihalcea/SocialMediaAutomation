import 'server-only';
import { AiMediaJobKind, JobStatus, MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { PermanentJobError } from '@/lib/queue/runner';
import { imageProvider } from '@/lib/ai';
import { resolveImageProviderName } from '@/lib/ai/provider-selection';
import { mediaKey, storage } from '@/lib/storage';
import {
  MockAudioProvider,
  MockImageEditingProvider,
  MockVideoGenerationProvider,
} from '@/lib/ai/providers/mock-media';
import {
  OpenAiAudioProvider,
  OpenAiImageEditingProvider,
  OpenAiVideoGenerationProvider,
} from '@/lib/ai/providers/external-media';
import { env } from '@/lib/env';
import type { AiMediaResult } from '@/lib/ai/types';
import { assertWithinLimit, currentMonthUsage, incrementUsage } from '@/lib/billing/limits';
import { notify } from '@/lib/notifications/service';
import { enqueue } from '@/lib/queue';

export function mediaProviderDescriptor(kind: AiMediaJobKind, forceMock = false) {
  const provider = forceMock
    ? 'mock'
    : kind.startsWith('IMAGE')
      ? resolveImageProviderName(env.AI_PROVIDER, env.AI_IMAGE_PROVIDER)
      : env.AI_PROVIDER;
  const external = provider === 'openai';
  if (kind.startsWith('VIDEO')) return { provider: external ? 'openai' : 'mock', model: external ? 'external-video' : 'mock-video-1' };
  if (kind.startsWith('AUDIO')) return { provider: external ? 'openai' : 'mock', model: external ? 'external-audio' : 'mock-audio-1' };
  return { provider: external ? 'openai' : 'mock', model: external ? env.OPENAI_IMAGE_MODEL : 'mock-image-edit-1' };
}

/**
 * Creates an AI media job row and queues it.
 *
 * Shared by the studio action and by workflow steps, so both go through the
 * same quota check and the same dedupe key rather than one of them drifting.
 */
export async function createAiMediaJob(input: {
  workspaceId: string;
  userId: string;
  kind: AiMediaJobKind;
  prompt: string;
  inputAssetIds?: string[];
  /** Per-step override for inexpensive workflow testing. */
  forceMock?: boolean;
}): Promise<{ id: string; kind: AiMediaJobKind; status: JobStatus }> {
  const used = await currentMonthUsage(input.workspaceId, 'ai_generations');
  await assertWithinLimit(input.workspaceId, 'aiGenerations', used);

  const descriptor = mediaProviderDescriptor(input.kind, input.forceMock);
  const job = await db.aiMediaJob.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: input.kind,
      status: 'QUEUED',
      provider: descriptor.provider,
      model: descriptor.model,
      prompt: input.prompt,
      inputAssetIds: input.inputAssetIds ?? [],
    },
    select: { id: true, kind: true, status: true },
  });
  await enqueue('ai-media-job', { aiMediaJobId: job.id }, {
    workspaceId: input.workspaceId,
    dedupeKey: `ai-media:${job.id}`,
  });
  return job;
}

export async function runAiMediaJob(aiMediaJobId: string): Promise<void> {
  const job = await db.aiMediaJob.findUnique({
    where: { id: aiMediaJobId },
    include: { workspace: { select: { slug: true } } },
  });
  if (!job) throw new PermanentJobError(`AI media job ${aiMediaJobId} no longer exists`);
  if (job.status === JobStatus.COMPLETED || job.status === JobStatus.CANCELLED) return;
  const startedAt = new Date();
  await db.aiMediaJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt, error: null } });
  let generationRecorded = false;
  try {
    const inputs = await loadInputs(job.workspaceId, job.inputAssetIds);
    const result = await produce(job.kind, job.prompt, inputs, job.provider === 'openai');
    const latest = await db.aiMediaJob.findUnique({ where: { id: job.id }, select: { status: true } });
    // Cancellation is durable and server-side. A provider request that was already
    // in flight may finish, but its bytes must not become a new library asset.
    if (latest?.status === JobStatus.CANCELLED) return;
    const filename = `ai-${job.kind.toLowerCase().replaceAll('_', '-')}.${result.extension}`;
    const key = mediaKey(job.workspaceId, filename);
    await storage().put(key, result.data, result.mimeType);
    const source = inputs[0]?.asset;
    const generation = await db.aiGeneration.create({
      data: {
        workspaceId: job.workspaceId,
        userId: job.userId,
        provider: job.provider,
        model: result.model,
        operation: operationFor(job.kind),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: job.estimatedCost ?? 0,
        succeeded: true,
      },
    });
    generationRecorded = true;
    const asset = await db.mediaAsset.create({
      data: {
        workspaceId: job.workspaceId,
        uploadedById: job.userId,
        filename,
        mimeType: result.mimeType,
        type: mediaType(result.mimeType),
        size: result.data.byteLength,
        width: result.width,
        height: result.height,
        duration: result.durationSeconds,
        storageKey: key,
        status: 'READY',
        aiGenerationId: generation.id,
        derivedFromId: source?.id,
        derivationPreset: job.kind,
        altText: job.prompt.slice(0, 500),
      },
    });
    await db.aiMediaJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        outputAssetId: asset.id,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        metadata: { mimeType: result.mimeType, model: result.model },
      },
    });
    await incrementUsage(job.workspaceId, 'ai_generations');
    if (job.userId) {
      await notify({
        workspaceId: job.workspaceId,
        userIds: [job.userId],
        type: 'AI_GENERATION_COMPLETE',
        title: 'AI media is ready',
        body: 'The generated asset is available in AI studio and the Media Library.',
        href: `/w/${job.workspace.slug}/studio`,
      });
    }
  } catch (error) {
    if (!generationRecorded) {
      await db.aiGeneration.create({
        data: {
          workspaceId: job.workspaceId,
          userId: job.userId,
          provider: job.provider,
          model: job.model,
          operation: operationFor(job.kind),
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
          succeeded: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    }
    await db.aiMediaJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    });
    throw error;
  }
}

async function produce(
  kind: AiMediaJobKind,
  prompt: string,
  inputs: Awaited<ReturnType<typeof loadInputs>>,
  external: boolean,
): Promise<AiMediaResult> {
  const image = inputs[0];
  const editor = external ? new OpenAiImageEditingProvider() : new MockImageEditingProvider();
  const video = external ? new OpenAiVideoGenerationProvider() : new MockVideoGenerationProvider();
  const audio = external ? new OpenAiAudioProvider() : new MockAudioProvider();
  if (kind === 'IMAGE_GENERATE') {
    const result = await imageProvider(!external).generateImage({ prompt });
    return { ...result, extension: result.mimeType === 'image/svg+xml' ? 'svg' : 'png' };
  }
  if (kind === 'IMAGE_EDIT') return editor.editImage({ prompt, ...requiredInput(image, kind) });
  if (kind === 'IMAGE_VARIATION') return editor.createVariation({ prompt, ...requiredInput(image, kind) });
  if (kind === 'VIDEO_GENERATE') return video.generateVideo({ prompt });
  if (kind === 'VIDEO_ANIMATE') return video.animateImage({ prompt, image: requiredInput(image, kind).image });
  if (kind === 'AUDIO_TTS') return audio.textToSpeech({ text: prompt });
  throw new PermanentJobError(`${kind} produces text, not a MediaAsset, and is not a studio generation job.`);
}

async function loadInputs(workspaceId: string, ids: string[]) {
  const assets = await db.mediaAsset.findMany({ where: { workspaceId, id: { in: ids } } });
  if (assets.length !== ids.length) throw new PermanentJobError('One or more input assets are unavailable.');
  return Promise.all(assets.map(async (asset) => ({
    asset,
    image: await storage().get(asset.storageKey),
    mimeType: asset.mimeType,
  })));
}

function requiredInput(
  input: Awaited<ReturnType<typeof loadInputs>>[number] | undefined,
  kind: AiMediaJobKind,
) {
  if (!input) throw new PermanentJobError(`${kind} requires an input asset.`);
  return { image: input.image, mimeType: input.mimeType };
}

function mediaType(mimeType: string): MediaType {
  if (mimeType.startsWith('image/')) return 'IMAGE';
  if (mimeType.startsWith('video/')) return 'VIDEO';
  if (mimeType.startsWith('audio/')) return 'AUDIO';
  throw new PermanentJobError(`Unsupported generated media type: ${mimeType}`);
}

function operationFor(kind: AiMediaJobKind) {
  if (kind === 'IMAGE_EDIT' || kind === 'IMAGE_VARIATION') return 'IMAGE_EDIT' as const;
  if (kind.startsWith('IMAGE')) return 'IMAGE' as const;
  if (kind.startsWith('VIDEO')) return 'VIDEO' as const;
  return 'AUDIO' as const;
}
