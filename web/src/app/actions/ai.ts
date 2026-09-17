'use server';

import { AiMediaJobKind } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/guard';
import { confirmProposal, sendAssistantMessage } from '@/lib/ai/conversations';
import { generateImage, imageGenerationRunsInProcess } from '@/lib/ai';
import type { ImageSize } from '@/lib/ai/image-sizes';
import type { ImageProviderName } from '@/lib/ai/provider-selection';
import { db } from '@/lib/db';
import { mediaKey, storage } from '@/lib/storage';
import { invalid } from '@/lib/errors';
import { filenameFromPrompt } from '@/lib/media/filename-from-prompt';
import { createAiMediaJob } from '@/lib/ai/media-jobs';

export async function sendAssistantMessageAction(slug: string, conversationId: string | undefined, content: string) {
  const ctx = await requireWorkspace(slug, 'ai:use');
  return sendAssistantMessage({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    conversationId,
    content,
  });
}

export async function confirmAiProposalAction(slug: string, messageId: string) {
  // This fresh lookup is intentional: confirmation never trusts the role that
  // existed when the model proposed the action.
  const ctx = await requireWorkspace(slug, 'ai:use');
  const result = await confirmProposal({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    role: ctx.role,
    messageId,
  });
  revalidatePath(`/w/${slug}/assistant`);
  revalidatePath(`/w/${slug}/calendar`);
  revalidatePath(`/w/${slug}/workflows`);
  if (result.workflowId) revalidatePath(`/w/${slug}/workflows/${result.workflowId}`);
  if (result.workflowId && result.runId) {
    revalidatePath(`/w/${slug}/workflows/${result.workflowId}/runs/${result.runId}`);
  }
  return result;
}

export async function generateStudioImageAction(
  slug: string,
  input: { prompt: string; size?: ImageSize; sourceAssetId?: string; provider?: ImageProviderName },
) {
  const ctx = await requireWorkspace(slug, 'ai:use');
  const prompt = input.prompt.trim();
  if (prompt.length < 3) throw invalid('Describe the image you want.');
  const provider = imageSourceOf(input.provider);

  // Generating here would block the request for a minute or more and, on a
  // host without the CLI, could not succeed at all. Hand it to the worker and
  // return the job — the studio already renders queued work and polls it.
  if (!imageGenerationRunsInProcess(provider)) {
    const job = await createAiMediaJob({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      kind: AiMediaJobKind.IMAGE_GENERATE,
      prompt,
      size: input.size,
      provider,
      inputAssetIds: input.sourceAssetId ? [input.sourceAssetId] : [],
    });
    revalidatePath(`/w/${slug}/studio`);
    return { queued: true as const, job: { id: job.id, kind: job.kind, status: job.status, provider: job.provider } };
  }

  const result = await generateImage({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    prompt,
    size: input.size,
    provider,
  });
  const filename = filenameFromPrompt(prompt, result.mimeType === 'image/svg+xml' ? 'svg' : 'png');
  const key = mediaKey(ctx.workspace.id, filename);
  await storage().put(key, result.data, result.mimeType);
  const source = input.sourceAssetId
    ? await db.mediaAsset.findFirst({ where: { id: input.sourceAssetId, workspaceId: ctx.workspace.id } })
    : null;
  const asset = await db.mediaAsset.create({
    data: {
      workspaceId: ctx.workspace.id,
      uploadedById: ctx.user.id,
      filename,
      mimeType: result.mimeType,
      type: 'IMAGE',
      size: result.data.byteLength,
      storageKey: key,
      status: 'READY',
      width: Number(input.size?.split('x')[0] ?? 1024),
      height: Number(input.size?.split('x')[1] ?? 1024),
      altText: prompt.slice(0, 500),
      aiGenerationId: result.generationId,
      derivedFromId: source?.id,
      derivationPreset: source ? 'regenerate' : null,
    },
  });
  revalidatePath(`/w/${slug}/studio`);
  revalidatePath(`/w/${slug}/media`);
  return { queued: false as const, asset: { ...asset, url: await storage().signedUrl(asset.storageKey) } };
}

export async function createAiMediaJobAction(
  slug: string,
  input: { kind: AiMediaJobKind; prompt: string; inputAssetIds?: string[] },
) {
  const ctx = await requireWorkspace(slug, 'ai:use');
  if (!['IMAGE_EDIT', 'IMAGE_VARIATION', 'VIDEO_GENERATE', 'VIDEO_ANIMATE', 'AUDIO_TTS'].includes(input.kind)) {
    throw invalid('Choose a supported studio operation.');
  }
  const ids = input.inputAssetIds ?? [];
  const prompt = input.prompt.trim();
  if (prompt.length < 3) throw invalid('Describe the media you want.');
  if (ids.length) {
    const count = await db.mediaAsset.count({ where: { workspaceId: ctx.workspace.id, id: { in: ids } } });
    if (count !== ids.length) throw invalid('One or more source assets are unavailable.');
  }
  const job = await createAiMediaJob({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    kind: input.kind,
    prompt,
    inputAssetIds: ids,
  });
  revalidatePath(`/w/${slug}/studio`);
  return { id: job.id, kind: job.kind, status: job.status, provider: job.provider };
}

export async function cancelAiMediaJobAction(slug: string, jobId: string) {
  const ctx = await requireWorkspace(slug, 'ai:use');
  const result = await db.aiMediaJob.updateMany({
    where: {
      id: jobId,
      workspaceId: ctx.workspace.id,
      status: { in: ['QUEUED', 'RUNNING'] },
    },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });
  if (!result.count) throw invalid('This generation can no longer be cancelled.');
  revalidatePath(`/w/${slug}/studio`);
  return { id: jobId, status: 'CANCELLED' as const };
}

export async function retryAiMediaJobAction(slug: string, jobId: string, prompt?: string) {
  const ctx = await requireWorkspace(slug, 'ai:use');
  const previous = await db.aiMediaJob.findFirst({
    where: { id: jobId, workspaceId: ctx.workspace.id, status: { in: ['FAILED', 'CANCELLED', 'COMPLETED'] } },
  });
  if (!previous) throw invalid('This generation is not available to retry.');
  return createAiMediaJobAction(slug, {
    kind: previous.kind,
    prompt: prompt?.trim() || previous.prompt,
    inputAssetIds: previous.inputAssetIds,
  });
}

export async function deleteGeneratedAssetAction(slug: string, assetId: string) {
  const ctx = await requireWorkspace(slug, 'ai:use');
  const asset = await db.mediaAsset.findFirst({
    where: {
      id: assetId,
      workspaceId: ctx.workspace.id,
      OR: [
        { aiGenerationId: { not: null } },
        { derivationPreset: { in: ['IMAGE_GENERATE', 'IMAGE_EDIT', 'IMAGE_VARIATION', 'VIDEO_GENERATE', 'VIDEO_ANIMATE', 'AUDIO_TTS'] } },
      ],
    },
  });
  if (!asset) throw invalid('This generated asset is no longer available.');

  // The attachment row cascades when the asset goes, so without this a post
  // silently loses its media here — the worst of the three behaviours this
  // verb had, because nothing tells anyone it happened.
  const attached = await db.postMedia.findMany({
    where: { mediaAssetId: asset.id },
    select: { postPlatform: { select: { post: { select: { title: true, status: true } } } } },
  });
  if (attached.length > 0) {
    const titles = [...new Set(attached.map(({ postPlatform }) => postPlatform.post.title || 'Untitled post'))];
    throw invalid(
      `This is attached to ${titles.join(', ')}. Delete it from the Media library instead, where you can choose whether to take it out of those posts or delete them too.`,
    );
  }

  await storage().delete(asset.storageKey);
  await db.$transaction([
    db.aiMediaJob.updateMany({
      where: { workspaceId: ctx.workspace.id, outputAssetId: asset.id },
      data: { outputAssetId: null },
    }),
    db.mediaAsset.delete({ where: { id: asset.id } }),
  ]);
  revalidatePath(`/w/${slug}/studio`);
  revalidatePath(`/w/${slug}/media`);
  return { id: asset.id };
}

/**
 * The studio picks between the API and the subscription; anything else means
 * no choice was made and the deployment's own setting stands. A client cannot
 * elect 'mock' here — a free result is a deployment mode, not a request
 * parameter, and honouring it would let the browser opt out of billing.
 */
function imageSourceOf(value: unknown): ImageProviderName | undefined {
  return value === 'openai' || value === 'image-use' ? value : undefined;
}
