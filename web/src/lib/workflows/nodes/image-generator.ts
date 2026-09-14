import 'server-only';
import { MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { generateImage } from '@/lib/ai';
import { mediaKey, storage } from '@/lib/storage';
import { PermanentJobError } from '@/lib/queue/runner';
import type { NodeRunContext } from '@/lib/workflows/node-context';

interface Config {
  size: '1024x1024' | '1024x1536' | '1536x1024';
  maxImages: number;
}

/**
 * One image per prompt.
 *
 * Written to be resumable: each image is saved and the partial output persisted
 * before the next is requested, so a failure on item seven does not discard the
 * six that were already paid for. A retry reads what is already there and picks
 * up from that index.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const prompts = asStringArray(ctx.inputs.prompts).slice(0, config.maxImages);
  const titles = asStringArray(ctx.inputs.titles);

  if (prompts.length === 0) {
    throw new PermanentJobError('No prompts reached this step, so there is nothing to generate.');
  }
  if (!ctx.userId) {
    throw new PermanentJobError('This workflow has no owner to bill AI usage to. Open it and save it again.');
  }

  // Resume: anything a previous attempt already produced stays produced.
  const done = asStringArray(ctx.previousOutput?.images);
  const images: string[] = [...done];
  const [width, height] = config.size.split('x').map(Number);

  for (let index = images.length; index < prompts.length; index++) {
    await ctx.assertNotCancelled();
    await ctx.heartbeat();

    const prompt = prompts[index];
    const result = await generateImage({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      prompt,
      size: config.size,
    });

    const extension = result.mimeType === 'image/svg+xml' ? 'svg' : 'png';
    const filename = `${slug(titles[index] ?? `image-${index + 1}`)}.${extension}`;
    const key = mediaKey(ctx.workspaceId, filename);
    await storage().put(key, result.data, result.mimeType);

    const asset = await db.mediaAsset.create({
      data: {
        workspaceId: ctx.workspaceId,
        uploadedById: ctx.userId,
        filename,
        mimeType: result.mimeType,
        type: MediaType.IMAGE,
        size: result.data.byteLength,
        width,
        height,
        storageKey: key,
        status: 'READY',
        altText: prompt.slice(0, 500),
        aiGenerationId: result.generationId,
      },
      select: { id: true },
    });

    images.push(asset.id);
    await ctx.emitAssets('images', [asset.id]);
    // Persisted per item, so the work survives a crash on the next one.
    await ctx.saveProgress({ images, _progress: { done: images.length, total: prompts.length } });
  }

  return { images, titles: titles.slice(0, images.length) };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

const slug = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
