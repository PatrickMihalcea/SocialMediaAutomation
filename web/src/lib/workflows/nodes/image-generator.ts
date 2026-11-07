import 'server-only';
import { MediaType } from '@prisma/client';
import { db } from '@/lib/db';
import { generateImage } from '@/lib/ai';
import type { ImageSize } from '@/lib/ai/image-sizes';
import type { ImageProviderName } from '@/lib/ai/provider-selection';
import { mediaKey, storage } from '@/lib/storage';
import { filenameFromPrompt } from '@/lib/media/filename-from-prompt';
import { PermanentJobError } from '@/lib/queue/runner';
import type { NodeRunContext } from '@/lib/workflows/node-context';
import type { AiImageReference } from '@/lib/ai/types';
import { loadReferenceImage } from '@/lib/workflows/nodes/reference-image';

export interface Config {
  size: ImageSize;
  style: string;
  /** What an attached reference is for; decides what the model is told. */
  referenceUse: 'layout' | 'subject';
  /** A style reference set in the panel, used when nothing is wired to the port. */
  styleImage: string | null;
  maxImages: number;
  /** Which source renders this step, independent of the deployment's setting. */
  provider: ImageProviderName;
  /** Superseded by `provider`. Still read, so steps saved before it keep mocking. */
  useMockGeneration: boolean;
}

/**
 * A step that was set to mock before this setting existed stays mocked. Getting
 * this wrong the other way would quietly start spending real quota on a
 * workflow somebody built specifically to avoid it. The config panel clears the
 * old flag as soon as anyone picks a source, so it only ever shadows a step
 * nobody has opened since.
 */
export function resolveStepProvider(config: Config): ImageProviderName {
  return config.useMockGeneration ? 'mock' : config.provider;
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

  // Loaded once for the whole run, not per image: they are the same bytes
  // every time, and re-reading them from the store for each of eight images is
  // eight downloads of the same two files.
  const reference = await loadReferenceImage(ctx);
  const style = await loadReferenceImage(ctx, 'styleReference', config.styleImage);
  const references: AiImageReference[] = [
    ...(reference
      ? [{ ...reference, role: config.referenceUse === 'subject' ? 'subject' as const : 'composition' as const }]
      : []),
    ...(style ? [{ ...style, role: 'style' as const }] : []),
  ];

  const provider = resolveStepProvider(config);
  const parallel = PARALLEL_IMAGES[provider];
  const [width, height] = config.size.split('x').map(Number);

  // Resume: anything a previous attempt already produced stays produced. Kept
  // by prompt, not as a list, because pictures made side by side finish out of
  // order and a failure can leave a gap in the middle.
  const slots = restoreSlots(ctx.previousOutput, prompts.length);
  const missing = prompts.map((_, index) => index).filter((index) => !slots[index]);

  // What each picture in hand is doing, written down as the provider says it.
  //
  // One call can legitimately take minutes, and without this the step shows
  // the same number for the whole of it — so a picture being made and a
  // picture wedged look identical from the outside.
  const inFlight = new Map<number, number>();
  let stage = 'starting';
  const snapshot = () => {
    const images = slots.filter((id): id is string => Boolean(id));
    const since = inFlight.size ? Math.min(...inFlight.values()) : undefined;
    return {
      images,
      _slots: slots,
      _progress: {
        done: images.length,
        total: prompts.length,
        ...(inFlight.size ? { stage: inFlight.size > 1 ? `${inFlight.size} at once, ${stage}` : stage, since } : {}),
      },
    };
  };
  // Taken when asked for and written in that order. Pictures finishing
  // together would otherwise race their saves, and an older snapshot landing
  // last would forget one; taken at write time instead, a stage reported and
  // replaced within one write would never be recorded at all.
  let writing: Promise<void> = Promise.resolve();
  const record = () => {
    const state = snapshot();
    // One failed write must not swallow every write after it.
    const write = writing.catch(() => {}).then(() => ctx.saveProgress(state));
    writing = write;
    return write;
  };

  const renderOne = async (index: number): Promise<string> => {
    const prompt = composePrompt({
      prompt: prompts[index],
      style: config.style,
      hasReference: Boolean(reference),
      referenceUse: config.referenceUse,
      hasStyleReference: Boolean(style),
    });
    const result = await generateImage({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId!,
      prompt,
      size: config.size,
      references,
      provider,
      onStage: (next) => {
        if (next === stage) return;
        stage = next;
        // Not awaited: the generation must not wait on a status write.
        void record().catch(() => {});
      },
    });

    const extension = result.mimeType === 'image/svg+xml' ? 'svg' : 'png';
    const title = titles[index];
    const filename = title
      ? `${slug(title)}.${extension}`
      : filenameFromPrompt(prompt, extension, `image-${index + 1}`);
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
    return asset.id;
  };

  // Stage changes write a heartbeat, but a provider can sit on one stage for
  // longer than the sweeper waits — a large ComfyUI render on a laptop with
  // no step progress to report. Alive is alive, whatever it is saying.
  const beat = setInterval(() => void ctx.heartbeat(), 60_000);
  let failure: unknown = null;
  let next = 0;
  // Each lane takes the next missing picture until none are left. A failure
  // stops new pictures starting but lets the ones already running finish and
  // be saved: they are paid for, and the retry then asks only for the gaps.
  const lane = async () => {
    while (failure === null && next < missing.length) {
      const index = missing[next++];
      try {
        await ctx.assertNotCancelled();
        await ctx.heartbeat();
        if (inFlight.size === 0) stage = 'starting';
        inFlight.set(index, Date.now());
        await record();
        slots[index] = await renderOne(index);
        await ctx.emitAssets('images', [slots[index]!]);
      } catch (error) {
        failure ??= error;
      } finally {
        inFlight.delete(index);
      }
      // Persisted per item, so the work survives a crash on the next one.
      await record();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(parallel, missing.length) }, lane));
  } finally {
    clearInterval(beat);
  }
  if (failure !== null) throw failure;

  const images = slots as string[];
  return { images, titles: titles.slice(0, images.length) };
}

/**
 * How many pictures a provider makes at once.
 *
 * Codex requests are independent HTTP calls, and the image CLI allows four at
 * a time per machine — its authors measured that on a Plus account with no
 * rate limiting — so a set of eight takes about a quarter of the time. The API
 * is the same. ComfyUI is one GPU that each render already fills: two at once
 * take twice as long each, with twice the memory, so it stays at one. The
 * mock is instant, and one at a time keeps it deterministic.
 */
const PARALLEL_IMAGES: Record<ImageProviderName, number> = {
  'image-use': 4,
  openai: 4,
  comfyui: 1,
  mock: 1,
};

/**
 * Which prompts already have their picture, from a previous attempt.
 *
 * `_slots` records it by prompt. An output written before pictures were made
 * side by side has only `images`, which was always the first N in order.
 */
function restoreSlots(previous: Record<string, unknown> | null, total: number): Array<string | null> {
  const slots = Array<string | null>(total).fill(null);
  const saved = previous?._slots;
  if (Array.isArray(saved)) {
    saved.slice(0, total).forEach((id, index) => {
      if (typeof id === 'string') slots[index] = id;
    });
    return slots;
  }
  asStringArray(previous?.images).slice(0, total).forEach((id, index) => {
    slots[index] = id;
  });
  return slots;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

const slug = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';

/**
 * A prompt telling the model the attached image is a layout, not artwork.
 *
 * Without it a reference is ambiguous: a sketch with "kitchen" written across
 * one box invites the model to letter that word into the render, and a pencil
 * drawing invites it to return a pencil drawing. It also says the layout is
 * approximate — a reference followed to the pixel produces eight images that
 * are the same picture, which is not what a reference is for.
 *
 * The long middle is there because "follow the arrangement" was read as
 * "match the shapes": a labelled circle came back as a round object and a box
 * as a square one, the guide's outline becoming the silhouette of whatever was
 * drawn inside it. A shape marks an area of the frame and a rough size. Saying
 * so once was not enough — it needs the rule, the two obvious failures named,
 * and a worked example, because the wrong reading is the more literal one.
 */
const LAYOUT_NOTE =
  'A layout reference image is attached. Follow it only for the arrangement of the scene — where the elements sit in the frame, their relative size and spacing, and the camera angle. '
  + 'Every box, circle, outline or dotted shape in it marks a REGION OF THE FRAME, not an object and not a silhouette. '
  + 'Whatever belongs in that region occupies roughly that area of the frame and keeps its own natural form: a circle does not mean a round object, a rectangle does not mean a rectangular one, and a shape\u2019s outline must never become the edge of the thing drawn there. '
  + 'A circle near the top left means "the subject sits near the top left and takes up about this much room", nothing more. '
  + 'Where a region is labelled, render what the label names in its ordinary shape, positioned there. '
  + 'None of the guides themselves appear in the finished image: no boxes, no outlines, no dotted or dashed lines, no words, labels, lettering, arrows or annotations, and no imitation of how the guide is drawn. '
  + 'Treat the layout as approximate: follow it closely enough to be recognisable, and deviate where it makes a better image.';

/**
 * The other half of the same question, and almost the opposite instruction.
 *
 * A set of scenes meant to read as one story needs the same faces in each, and
 * a description cannot carry that — "a wizard, a knight and a young woman"
 * written eight times produces eight different trios. The reference is the
 * cast, so how it is drawn is exactly what has to survive; the arrangement is
 * what must not, or every scene is the same picture.
 */
const SUBJECT_NOTE =
  'A reference image of the subjects is attached. Keep the same characters or objects it shows: their faces, build, hair, clothing, colouring and any distinguishing details must stay consistent, so every image in this set is recognisably the same cast. '
  + 'Do not copy the composition — the pose, camera angle, setting and framing come from the description below and should differ from the reference. '
  + 'Do not reproduce any words or lettering that appear in it.';

/**
 * A picture standing in for the words in the style box.
 *
 * Said separately from the other two notes because a run can carry both: this
 * arrangement in that style, or these characters in that style. The wording is
 * the exact inverse of the subject note — take how it looks, take nothing of
 * what is in it — because the most likely failure is the model rendering the
 * reference's content into the scene it was asked for.
 */
const STYLE_REFERENCE_NOTE =
  'A style reference image is attached. Match its artistic treatment — palette, linework, brush or grain, level of detail, lighting quality and overall finish — so this image looks like it belongs in the same body of work. '
  + 'Take nothing else from it: none of its subjects, objects, setting or composition appear in this image, and no words or lettering from it are reproduced. '
  + 'What is depicted comes entirely from the description above.';

/**
 * The style, appended as the instruction that wins.
 *
 * Identical text on every call, which is the whole point: the prompts vary by
 * design, and a style the writer was merely told about would be re-interpreted
 * in each of them. A set where some images are pixel art and some are
 * photographs is not a style applied loosely, it is a broken video.
 *
 * Last because the final thing in a prompt carries the most weight, and it
 * says outright that it overrides the description — a scene written as
 * "morning light through glass" must not quietly win over a style that asked
 * for flat two-colour linework. The layout note sits above it: how the image
 * is arranged and how it is rendered are different questions.
 */
export function composePrompt(input: {
  prompt: string;
  style: string;
  hasReference: boolean;
  referenceUse?: 'layout' | 'subject';
  hasStyleReference?: boolean;
}): string {
  const style = input.style.trim();
  return [
    input.prompt.trim(),
    input.hasReference
      ? (input.referenceUse === 'subject' ? SUBJECT_NOTE : LAYOUT_NOTE)
      : null,
    input.hasStyleReference ? STYLE_REFERENCE_NOTE : null,
    style
      ? 'STYLE — render this image in exactly this style, identically to every other image in this set. '
        + `Where anything above implies a different medium, finish or rendering technique, follow the style instead: ${style}`
      : null,
  ].filter(Boolean).join('\n\n');
}
