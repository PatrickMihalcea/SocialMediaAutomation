import 'server-only';
import sharp from 'sharp';
import { AiMediaJobKind, JobStatus, MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { PermanentJobError } from '@/lib/queue/runner';
import { imageProvider } from '@/lib/ai';
import { resolveImageProviderName, type ImageProviderName } from '@/lib/ai/provider-selection';
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
import { AiCredentialError, type AiMediaResult } from '@/lib/ai/types';
import { IMAGE_SIZE_VALUES, type ImageSize } from '@/lib/ai/image-sizes';
import { assertWithinLimit, currentMonthUsage, incrementUsage } from '@/lib/billing/limits';
import { notify } from '@/lib/notifications/service';
import { enqueue } from '@/lib/queue';

export function mediaProviderDescriptor(kind: AiMediaJobKind, override?: ImageProviderName) {
  const selected =
    override ??
    (kind.startsWith('IMAGE')
      ? resolveImageProviderName(env.AI_PROVIDER, env.AI_IMAGE_PROVIDER)
      : env.AI_PROVIDER);
  // image-use renders from a prompt and nothing else, so only generation can
  // use it. An edit or a variation has to hand an existing image to a model
  // that accepts one, which is AI_PROVIDER's job — falling through to the mock
  // editor instead would quietly return something unrelated to the source.
  if (selected === 'image-use') {
    if (kind === 'IMAGE_GENERATE') return { provider: 'image-use', model: 'image-use' };
    const editable = env.AI_PROVIDER === 'openai';
    return { provider: editable ? 'openai' : 'mock', model: editable ? env.OPENAI_IMAGE_MODEL : 'mock-image-edit-1' };
  }
  const provider = selected;
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
  /**
   * Generation only. A media job has no size column, so it rides in metadata —
   * without it a queued generation would silently come back square whatever
   * shape the studio asked for.
   */
  size?: ImageSize;
  /**
   * Which source to use, recorded on the job so the worker honours the choice
   * made when it was queued rather than whatever the environment says later.
   */
  provider?: ImageProviderName;
}): Promise<{ id: string; kind: AiMediaJobKind; status: JobStatus }> {
  const used = await currentMonthUsage(input.workspaceId, 'ai_generations');
  await assertWithinLimit(input.workspaceId, 'aiGenerations', used);

  const descriptor = mediaProviderDescriptor(input.kind, input.provider);
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
      metadata: input.size ? { size: input.size } : {},
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
    const result = await produce(job.kind, job.prompt, inputs, job.provider, requestedSize(job.metadata));
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
    // A credential nobody renews fails every image job from here on, and the
    // studio is not somewhere people sit watching. Tell them once, in the same
    // place an expired social connection would.
    if (error instanceof AiCredentialError && job.userId) {
      await notify({
        workspaceId: job.workspaceId,
        userIds: [job.userId],
        type: 'OAUTH_EXPIRED',
        title: 'Image generation is paused',
        body: error.message,
        href: `/w/${job.workspace.slug}/studio`,
      }).catch(() => {});
    }
    throw error;
  }
}

async function produce(
  kind: AiMediaJobKind,
  prompt: string,
  inputs: Awaited<ReturnType<typeof loadInputs>>,
  provider: string,
  size?: ImageSize,
): Promise<AiMediaResult> {
  const external = provider === 'openai';
  const image = inputs[0];
  const editor = external ? new OpenAiImageEditingProvider() : new MockImageEditingProvider();
  const video = external ? new OpenAiVideoGenerationProvider() : new MockVideoGenerationProvider();
  const audio = external ? new OpenAiAudioProvider() : new MockAudioProvider();
  if (kind === 'IMAGE_GENERATE') {
    const result = await imageProvider(imageProviderName(provider)).generateImage({ prompt, size });
    // Measured, not assumed. A subscription backend treats a requested size as
    // a hint — asking for 1024x1024 has come back 1254x1254 — and an asset row
    // claiming the size we asked for would misreport every crop downstream.
    const probed = await sharp(result.data).metadata().catch(() => null);
    return {
      ...result,
      width: probed?.width,
      height: probed?.height,
      extension: result.mimeType === 'image/svg+xml' ? 'svg' : 'png',
    };
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

/** The shape the studio asked for, ignored unless it is one the app offers. */
function requestedSize(metadata: unknown): ImageSize | undefined {
  const value = (metadata as { size?: unknown } | null)?.size;
  return typeof value === 'string' && (IMAGE_SIZE_VALUES as readonly string[]).includes(value)
    ? (value as ImageSize)
    : undefined;
}

/** A stored provider string, narrowed back to a name the factory understands. */
function imageProviderName(provider: string): ImageProviderName | undefined {
  return provider === 'openai' || provider === 'mock' || provider === 'image-use'
    ? provider
    : undefined;
}
