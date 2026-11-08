import 'server-only';
import { PermanentJobError } from '@/lib/queue/runner';
import type { NodeRunContext } from '@/lib/workflows/node-context';

interface Config {
  prompt: string;
  maxClips: number;
  seconds: number;
  motion: 'subtle' | 'natural' | 'lively';
  camera?: Camera;
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
  const total = Math.min(images.length, config.maxClips);
  // Clip times this step has measured, and the last ones this provider took,
  // for the first clip of a run.
  const durations: number[] = [];
  const typicalMs = await recentClipMs(db, animationProvider(config));

  for (let index = clips.length; index < Math.min(images.length, config.maxClips); index++) {
    await ctx.assertNotCancelled();
    await ctx.heartbeat();

    const job = await createAiMediaJob({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      kind: 'VIDEO_ANIMATE',
      prompt: withSound(withMotion(withCamera(config.prompt, config.camera), config.motion), config),
      inputAssetIds: [images[index]],
      provider: animationProvider(config),
      seconds: config.seconds,
      motion: config.motion,
      sound: config.sound ?? false,
      stillCamera: (config.camera ?? 'still') === 'still',
      inline: true,
    });
    // A clip on a laptop GPU can take longer than the sweeper waits for a
    // silent step, and nothing else writes while it renders. Without this the
    // step is declared dead and dispatched again mid-render.
    const beat = setInterval(() => void ctx.heartbeat(), 60_000);
    // When this clip started and how long one takes, so the run can show a
    // percentage that moves every second rather than once a clip.
    const since = Date.now();
    await ctx.saveProgress({
      clips: [...clips],
      _progress: { done: clips.length, total, since, expectedMs: expectedClipMs(durations, typicalMs, config.seconds) },
    });
    try {
      await runAiMediaJob(job.id);
    } finally {
      clearInterval(beat);
    }
    durations.push(Date.now() - since);

    const finished = await db.aiMediaJob.findUnique({
      where: { id: job.id },
      select: { outputAssetId: true, status: true, error: true },
    });
    if (finished?.status !== 'COMPLETED' || !finished.outputAssetId) {
      throw new Error(finished?.error ?? 'The video provider did not return a clip.');
    }

    clips.push(finished.outputAssetId);
    await ctx.emitAssets('clips', [finished.outputAssetId]);
    await ctx.saveProgress({ clips, _progress: { done: clips.length, total } });
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

/**
 * How long a clip should take: this step's own clips once it has any, else the
 * provider's recent clips, else a rough figure from the clip length.
 */
export function expectedClipMs(measured: number[], typical: number | null, seconds: number): number {
  if (measured.length) return measured.reduce((sum, value) => sum + value, 0) / measured.length;
  return typical ?? seconds * 6 * 60_000;
}

/** The middle of the provider's last few finished clips, in milliseconds. */
async function recentClipMs(
  db: typeof import('@/lib/db').db,
  provider: string | undefined,
): Promise<number | null> {
  const recent = await db.aiMediaJob.findMany({
    where: { kind: 'VIDEO_ANIMATE', ...(provider ? { provider } : {}), status: 'COMPLETED', durationMs: { not: null } },
    orderBy: { completedAt: 'desc' },
    take: 5,
    select: { durationMs: true },
  });
  const values = recent.map((job) => job.durationMs!).sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : null;
}

type Camera = 'still' | 'push-in' | 'pull-out' | 'pan-left' | 'pan-right' | 'orbit';

/**
 * The camera, said once and plainly, after the scene. Kept apart from the
 * scene prompt so the two cannot contradict each other, and so a still camera
 * can be enforced by more than words where the provider allows.
 */
const CAMERA_NOTES: Record<Camera, string> = {
  still: 'The camera is locked off on a tripod and does not move at all: no zoom, no push in, no pan, no drift.',
  'push-in': 'The camera pushes in slowly and steadily toward the subject.',
  'pull-out': 'The camera pulls back slowly and steadily from the subject.',
  'pan-left': 'The camera pans slowly to the left.',
  'pan-right': 'The camera pans slowly to the right.',
  orbit: 'The camera orbits gently around the subject with natural parallax.',
};

export function withCamera(prompt: string, camera: Camera = 'still'): string {
  return `${prompt.trim()} ${CAMERA_NOTES[camera]}`;
}
