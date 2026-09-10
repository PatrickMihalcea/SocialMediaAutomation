import 'server-only';
import { AiMediaJobKind, JobStatus, MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { PermanentJobError } from '@/lib/queue/runner';
import { aiProvider } from '@/lib/ai';
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

export function mediaProviderDescriptor(kind: AiMediaJobKind) {
  const external = env.AI_PROVIDER === 'openai';
  if (kind.startsWith('VIDEO')) return { provider: external ? 'openai' : 'mock', model: external ? 'external-video' : 'mock-video-1' };
  if (kind.startsWith('AUDIO')) return { provider: external ? 'openai' : 'mock', model: external ? 'external-audio' : 'mock-audio-1' };
  return { provider: external ? 'openai' : 'mock', model: external ? env.OPENAI_IMAGE_MODEL : 'mock-image-edit-1' };
}

export async function runAiMediaJob(aiMediaJobId: string): Promise<void> {
  const job = await db.aiMediaJob.findUnique({ where: { id: aiMediaJobId } });
  if (!job) throw new PermanentJobError(`AI media job ${aiMediaJobId} no longer exists`);
  if (job.status === JobStatus.COMPLETED || job.status === JobStatus.CANCELLED) return;
  const startedAt = new Date();
  await db.aiMediaJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt, error: null } });
  try {
    const inputs = await loadInputs(job.workspaceId, job.inputAssetIds);
    const result = await produce(job.kind, job.prompt, inputs);
    const filename = `ai-${job.kind.toLowerCase().replaceAll('_', '-')}.${result.extension}`;
    const key = mediaKey(job.workspaceId, filename);
    await storage().put(key, result.data, result.mimeType);
    const source = inputs[0]?.asset;
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
  } catch (error) {
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
): Promise<AiMediaResult> {
  const image = inputs[0];
  const external = env.AI_PROVIDER === 'openai';
  const editor = external ? new OpenAiImageEditingProvider() : new MockImageEditingProvider();
  const video = external ? new OpenAiVideoGenerationProvider() : new MockVideoGenerationProvider();
  const audio = external ? new OpenAiAudioProvider() : new MockAudioProvider();
  if (kind === 'IMAGE_GENERATE') {
    const result = await aiProvider().generateImage({ prompt });
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
