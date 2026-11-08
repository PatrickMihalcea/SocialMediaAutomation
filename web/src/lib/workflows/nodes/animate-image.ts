import 'server-only';
import { PermanentJobError } from '@/lib/queue/runner';
import type { NodeRunContext } from '@/lib/workflows/node-context';

interface Config {
  prompt: string;
  maxClips: number;
  seconds: number;
  motion: 'subtle' | 'natural' | 'lively';
  sound: boolean;
  soundPrompt?: string;
  provider: 'default' | 'comfyui';
  useMockGeneration: boolean;
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
      prompt: withSound(withMotion(config.prompt, config.motion), config),
      inputAssetIds: [images[index]],
      provider: animationProvider(config),
      seconds: config.seconds,
      motion: config.motion,
      sound: config.sound ?? false,
      inline: true,
    });
    // A clip on a laptop GPU can take longer than the sweeper waits for a
    // silent step, and nothing else writes while it renders. Without this the
    // step is declared dead and dispatched again mid-render.
    const beat = setInterval(() => void ctx.heartbeat(), 60_000);
    // What the clip is up to, shown on the run beside "4 of 7". Written in
    // order and never awaited by the render: a slow status write must not
    // hold up the GPU.
    const clipNumber = clips.length + 1;
    const since = Date.now();
    let writing: Promise<void> = Promise.resolve();
    const report = (stage: string) => {
      const progress = { clips: [...clips], _progress: { done: clips.length, total: images.length, stage: `clip ${clipNumber}, ${stage}`, since } };
      writing = writing.catch(() => {}).then(() => ctx.saveProgress(progress));
      void writing.catch(() => {});
    };
    report('starting');
    try {
      await runAiMediaJob(job.id, { onStage: report });
    } finally {
      clearInterval(beat);
      await writing.catch(() => {});
    }

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

/** Mock wins, as it always has; otherwise ComfyUI when chosen, else the deployment's own. */
export function animationProvider(config: Pick<Config, 'provider' | 'useMockGeneration'>) {
  if (config.useMockGeneration) return 'mock' as const;
  return config.provider === 'comfyui' ? 'comfyui' as const : undefined;
}

/**
 * The amount of motion, said in the prompt.
 *
 * Measured on LTX-2.5: how firmly the first frame holds the still made no
 * visible difference between the two extremes, because the model takes its
 * motion from the words. So the setting is words, appended last where they
 * carry most weight, and Natural adds none, leaving the camera movement as
 * written.
 */
const MOTION_NOTES: Record<Config['motion'], string | null> = {
  subtle: 'Keep the motion very subtle and slow, almost still: only the faintest movement, and the camera barely moves.',
  natural: null,
  lively: 'Make the motion lively and pronounced: clear, energetic movement in the scene and a confident camera move.',
};

export function withMotion(prompt: string, motion: Config['motion'] = 'natural'): string {
  const note = MOTION_NOTES[motion];
  return note ? `${prompt.trim()} ${note}` : prompt;
}

/**
 * What the clip should sound like, said in the prompt. LTX makes picture and
 * sound from one prompt, so there is no separate input: a sentence about the
 * sound is how it is steered. Left out when sound is off.
 */
export function withSound(prompt: string, config: Pick<Config, 'sound' | 'soundPrompt'>): string {
  const sound = config.soundPrompt?.trim();
  return config.sound && sound ? `${prompt} Sound: ${sound.replace(/[.\s]+$/, '')}.` : prompt;
}
