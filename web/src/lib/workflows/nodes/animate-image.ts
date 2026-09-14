import 'server-only';
import { PermanentJobError } from '@/lib/queue/runner';
import type { NodeRunContext } from '@/lib/workflows/node-context';

interface Config {
  prompt: string;
  maxClips: number;
}

/**
 * Turns stills into short clips with real depth motion.
 *
 * This is the honest replacement for the DepthFlow parallax the v1 pipeline
 * used: ffmpeg's zoompan is a 2D zoom with no depth or occlusion, so it is a
 * different effect, not a substitute. Real parallax needs either a GPU or a
 * video model, and this node takes the second route through the existing
 * VideoGenerationProvider.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const images = Array.isArray(ctx.inputs.images)
    ? ctx.inputs.images.filter((v): v is string => typeof v === 'string')
    : [];
  if (images.length === 0) throw new PermanentJobError('No images reached this step.');
  if (!ctx.userId) {
    throw new PermanentJobError('This workflow has no owner to bill AI usage to. Open it and save it again.');
  }

  const { createAiMediaJob, runAiMediaJob } = await import('@/lib/ai/media-jobs');
  const { db } = await import('@/lib/db');
  const done = Array.isArray(ctx.previousOutput?.clips)
    ? (ctx.previousOutput.clips as string[])
    : [];
  const clips: string[] = [...done];

  for (let index = clips.length; index < Math.min(images.length, config.maxClips); index++) {
    await ctx.assertNotCancelled();
    await ctx.heartbeat();

    const job = await createAiMediaJob({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      kind: 'VIDEO_ANIMATE',
      prompt: config.prompt,
      inputAssetIds: [images[index]],
    });
    await runAiMediaJob(job.id);

    const finished = await db.aiMediaJob.findUnique({
      where: { id: job.id },
      select: { outputAssetId: true, status: true, error: true },
    });
    if (finished?.status !== 'COMPLETED' || !finished.outputAssetId) {
      throw new Error(finished?.error ?? 'The video provider did not return a clip.');
    }

    clips.push(finished.outputAssetId);
    await ctx.emitAssets('clips', [finished.outputAssetId]);
    await ctx.saveProgress({ clips, _progress: { done: clips.length, total: images.length } });
  }

  return { clips };
}
