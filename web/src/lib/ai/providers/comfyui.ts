import 'server-only';
import { execFile } from 'node:child_process';
import { loopCrossfade } from '@/lib/media/loop-crossfade';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { env } from '@/lib/env';
import {
  AiError,
  type AiImageReference,
  type AiImageResult,
  type AiImageRole,
  type AiMediaResult,
  type AiMessage,
  type AiObjectResult,
  type AiProvider,
  type AiTextResult,
  type AnimationMotion,
  type ImageEditingProvider,
  type VideoClipOptions,
  type VideoGenerationProvider,
} from '@/lib/ai/types';
import type { ImageSize } from '@/lib/ai/image-sizes';

/**
 * Generation on the operator's own machine, through a ComfyUI server.
 *
 * ComfyUI knows nothing of prompts-in, pictures-out: it runs a graph. So the
 * graphs are files the operator exports from ComfyUI ("Export (API)"), one per
 * operation, with `{{placeholders}}` where this side fills in the prompt, the
 * size and any pictures. Which model, which sampler, which LoRA — all of that
 * lives in the file and changes without a deploy. This class only picks a
 * file, fills it in, queues it and reads back what it saved.
 *
 * It runs only where COMFYUI_URL is set, which is the local worker. Everything
 * that asks for ComfyUI elsewhere queues the work for that worker instead (see
 * LOCAL_QUEUE), because the cloud has no route to the laptop's localhost.
 */

export type ComfyOperation = 'txt2img' | 'edit' | 'variation' | 'txt2vid' | 'img2vid' | 'img2vid_loop';

/** What the operation's files are called, and what each is for. Also the README's table. */
export const COMFY_OPERATIONS: Record<ComfyOperation, string> = {
  txt2img: 'Image generator steps and studio images',
  edit: 'Studio image edits',
  variation: 'Studio variations',
  txt2vid: 'Studio video from a prompt',
  img2vid: 'Animate image steps and studio animations',
  img2vid_loop: 'Animate image steps set to loop: the still is the first and the last frame',
};

const ROLE_PLACEHOLDERS: Record<AiImageRole, string> = {
  subject: 'subject_image',
  style: 'style_image',
  composition: 'composition_image',
};

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.flac', '.wav', '.mp3']);
const run = promisify(execFile);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const POLL_MS = 1_000;
/** How many polls between asking whether to stop: every five seconds. */
const STOP_CHECK_POLLS = 5;

// ---------------------------------------------------------------- templates

export interface ComfyTemplate {
  /** The file name without `.json`, recorded as the model. */
  name: string;
  operation: ComfyOperation;
  /** Reference roles the graph has a slot for, read off its placeholders. */
  roles: Set<AiImageRole>;
  placeholders: Set<string>;
  graph: Record<string, unknown>;
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export async function loadTemplates(directory = workflowsDirectory()): Promise<ComfyTemplate[]> {
  let files: string[];
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith('.json'));
  } catch {
    return [];
  }
  const templates: ComfyTemplate[] = [];
  for (const file of files) {
    const name = file.slice(0, -'.json'.length);
    const operation = name.split('-')[0] as ComfyOperation;
    if (!(operation in COMFY_OPERATIONS)) continue;
    const text = await readFile(join(directory, file), 'utf8');
    let graph: Record<string, unknown>;
    try {
      graph = JSON.parse(text) as Record<string, unknown>;
    } catch (cause) {
      throw new AiError(`ComfyUI workflow ${file} is not valid JSON.`, { cause });
    }
    // The UI's own save format has a `nodes` array; the API wants node ids as
    // keys. Feeding it the wrong one fails deep inside ComfyUI with nothing
    // that names the file, so say it here.
    if (Array.isArray(graph.nodes)) {
      throw new AiError(
        `ComfyUI workflow ${file} is in the editor's format. Re-save it with "Export (API)".`,
      );
    }
    const placeholders = new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]));
    const roles = new Set(
      (Object.keys(ROLE_PLACEHOLDERS) as AiImageRole[]).filter((role) =>
        placeholders.has(ROLE_PLACEHOLDERS[role]),
      ),
    );
    templates.push({ name, operation, roles, placeholders, graph });
  }
  return templates;
}

/**
 * The file that uses the most of the references on offer and needs no more.
 *
 * So `txt2img.json`, `txt2img-style.json` and `txt2img-subject-style.json` can
 * sit side by side: a step with a style picture gets the second, one with
 * both gets the third, and one with neither the first. A file that wants a
 * picture the call does not have is never chosen — it cannot be filled in.
 * References no file has a slot for are dropped, which is what the provider
 * interface asks of a provider that cannot follow them.
 */
export function pickTemplate(
  templates: ComfyTemplate[],
  operation: ComfyOperation,
  available: Set<AiImageRole>,
): ComfyTemplate {
  const usable = templates
    .filter((template) => template.operation === operation)
    .filter((template) => [...template.roles].every((role) => available.has(role)))
    .sort((a, b) => b.roles.size - a.roles.size || a.name.length - b.name.length);
  if (!usable[0]) {
    throw new AiError(
      `There is no ComfyUI workflow for ${operation}. Export one from ComfyUI with "Export (API)" `
        + `and save it as ${operation}.json in ${workflowsDirectory()}.`,
    );
  }
  return usable[0];
}

/**
 * The graph with every placeholder filled.
 *
 * A string that is nothing but a placeholder becomes the value itself, so
 * `"width": "{{width}}"` arrives as the number ComfyUI's widget expects rather
 * than the string "1024". One embedded in longer text is spliced in as text.
 */
export function fillTemplate(
  template: ComfyTemplate,
  values: Record<string, string | number>,
): Record<string, unknown> {
  const missing = [...template.placeholders].filter((key) => !(key in values));
  if (missing.length) {
    throw new AiError(
      `ComfyUI workflow ${template.name}.json asks for ${missing.map((key) => `{{${key}}}`).join(', ')}, `
        + 'which this operation does not supply.',
    );
  }
  const fill = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const whole = /^\{\{(\w+)\}\}$/.exec(value);
      if (whole) return values[whole[1]];
      return value.replace(PLACEHOLDER, (_, key: string) => String(values[key]));
    }
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fill(inner)]));
    }
    return value;
  };
  return fill(template.graph) as Record<string, unknown>;
}

function workflowsDirectory(): string {
  const configured = env.COMFYUI_WORKFLOWS_DIR;
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

// ---------------------------------------------------------------- client

interface ComfyFile {
  filename: string;
  subfolder: string;
  type: string;
}

/**
 * The four ComfyUI endpoints this needs, and nothing else.
 *
 * Exported for the local worker, which asks whether the server is up before
 * it takes any work — a job claimed while ComfyUI is closed would only fail.
 */
export class ComfyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Whether the server answers at all. */
  async ping(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(this.url('/system_stats'), { signal: AbortSignal.timeout(3_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Puts a picture where a LoadImage node can find it, and returns the name to give that node. */
  async upload(data: Buffer, mimeType: string): Promise<string> {
    const form = new FormData();
    const extension = Object.entries(MIME_TYPES).find(([, mime]) => mime === mimeType)?.[0] ?? '.png';
    form.append('image', new Blob([new Uint8Array(data)], { type: mimeType }), `${randomUUID()}${extension}`);
    form.append('type', 'input');
    form.append('subfolder', 'bridge88');
    form.append('overwrite', 'true');
    const response = await this.request('/upload/image', { method: 'POST', body: form });
    const body = (await response.json()) as { name: string; subfolder?: string };
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
  }

  async queue(graph: Record<string, unknown>, clientId: string): Promise<string> {
    const response = await this.fetchImpl(this.url('/prompt'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    }).catch((cause: unknown) => {
      throw unreachable(this.baseUrl, cause);
    });
    const body = (await response.json().catch(() => ({}))) as {
      prompt_id?: string;
      error?: { message?: string; details?: string };
      node_errors?: Record<string, { errors?: Array<{ message?: string; details?: string }>; class_type?: string }>;
    };
    if (!response.ok || !body.prompt_id) {
      // A graph ComfyUI refuses — a missing model, a node that is not
      // installed — is wrong in the same way on every retry.
      const nodes = Object.values(body.node_errors ?? {}).flatMap((node) =>
        (node.errors ?? []).map((error) => `${node.class_type ?? 'node'}: ${error.message ?? ''} ${error.details ?? ''}`.trim()),
      );
      throw new AiError(
        `ComfyUI refused the workflow: ${[body.error?.message, ...nodes].filter(Boolean).join('; ') || response.statusText}`,
      );
    }
    return body.prompt_id;
  }

  /**
   * Waits for one prompt to finish and returns the files it saved.
   *
   * Polls history for the result, which is the one thing ComfyUI keeps. The
   * websocket is only for progress, and a dropped socket costs nothing but the
   * percentage.
   */
  async wait(
    promptId: string,
    clientId: string,
    options: {
      timeoutMs: number;
      onStage?: (stage: string) => void;
      graph?: Record<string, unknown>;
      /** Asked every few seconds; true stops the render in ComfyUI and gives up. */
      shouldStop?: () => Promise<boolean>;
    },
  ): Promise<ComfyFile[]> {
    const deadline = Date.now() + options.timeoutMs;
    const socket = this.watchProgress(promptId, clientId, options.onStage, options.graph);
    let lastStage = '';
    const report = (stage: string) => {
      if (stage === lastStage) return;
      lastStage = stage;
      options.onStage?.(stage);
    };
    try {
      let polls = 0;
      while (Date.now() < deadline) {
        // A cancelled run must not keep the only GPU busy for the rest of a
        // clip nobody will use, so the render itself is stopped.
        if (options.shouldStop && polls++ % STOP_CHECK_POLLS === 0 && await options.shouldStop().catch(() => false)) {
          await this.abandon(promptId);
          throw new AiError('Stopped: the run was cancelled.', { retryable: false });
        }
        const response = await this.request(`/history/${encodeURIComponent(promptId)}`);
        const history = (await response.json()) as Record<string, HistoryEntry>;
        const entry = history[promptId];
        if (entry?.status?.status_str === 'error') throw executionError(entry);
        if (entry?.status?.completed || (entry && !entry.status)) return outputFiles(entry);
        if (!socket.reporting()) {
          report((await this.isRunning(promptId)) ? 'rendering' : 'waiting in ComfyUI');
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      await this.abandon(promptId);
      throw new AiError(
        `ComfyUI did not finish within ${Math.round(options.timeoutMs / 60_000)} minutes. `
          + 'Raise COMFYUI_TIMEOUT_MS if this workflow is genuinely that slow.',
        { retryable: true },
      );
    } finally {
      socket.close();
    }
  }

  async download(file: ComfyFile): Promise<Buffer> {
    const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
    const response = await this.request(`/view?${query}`);
    return Buffer.from(await response.arrayBuffer());
  }

  private async isRunning(promptId: string): Promise<boolean> {
    const response = await this.request('/queue');
    const queue = (await response.json()) as { queue_running?: unknown[][] };
    return (queue.queue_running ?? []).some((item) => item[1] === promptId);
  }

  /** Best effort: a render nobody is waiting for should not hold the GPU. */
  private async abandon(promptId: string): Promise<void> {
    await this.fetchImpl(this.url('/queue'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
    }).catch(() => {});
    if (await this.isRunning(promptId).catch(() => false)) {
      await this.fetchImpl(this.url('/interrupt'), { method: 'POST' }).catch(() => {});
    }
  }

  /**
   * What ComfyUI is doing, in words: which sampling pass and step, or which
   * stage around them. ComfyUI says which node is running and how far a
   * sampler has got; the graph says what each node is. A video is a few
   * passes of a handful of steps each, so every change is reported.
   */
  private watchProgress(
    promptId: string,
    clientId: string,
    onStage?: (stage: string) => void,
    graph?: Record<string, unknown>,
  ) {
    let reporting = false;
    let socket: WebSocket | null = null;
    if (onStage && typeof WebSocket !== 'undefined') {
      try {
        socket = new WebSocket(`${this.url('/ws').replace(/^http/, 'ws')}?clientId=${encodeURIComponent(clientId)}`);
        const describe = progressDescriber(graph ?? {});
        socket.addEventListener('message', (event) => {
          if (typeof event.data !== 'string') return;
          try {
            const message = JSON.parse(event.data) as ComfyMessage;
            if (message.data?.prompt_id !== promptId) return;
            const stage = describe(message);
            if (!stage) return;
            reporting = true;
            onStage(stage);
          } catch {
            // A message this does not understand is not this caller's problem.
          }
        });
        socket.addEventListener('error', () => { reporting = false; });
      } catch {
        socket = null;
      }
    }
    return {
      reporting: () => reporting,
      close: () => { try { socket?.close(); } catch { /* already gone */ } },
    };
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await this.fetchImpl(this.url(path), init).catch((cause: unknown) => {
      throw unreachable(this.baseUrl, cause);
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AiError(`ComfyUI answered ${response.status} to ${path.split('?')[0]}: ${text.slice(0, 300)}`, {
        retryable: response.status >= 500,
      });
    }
    return response;
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }
}

interface HistoryEntry {
  outputs?: Record<string, Record<string, unknown>>;
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: Array<[string, { exception_message?: string; node_type?: string }]>;
  };
}

/** Retryable: ComfyUI being closed is the laptop's state, not the job's fault. */
function unreachable(baseUrl: string, cause: unknown): AiError {
  return new AiError(`ComfyUI is not answering at ${baseUrl}. Is it running?`, { retryable: true, cause });
}

function executionError(entry: HistoryEntry): AiError {
  const failure = entry.status?.messages?.find(([type]) => type === 'execution_error')?.[1];
  const detail = failure
    ? `${failure.node_type ?? 'A node'} failed: ${failure.exception_message?.trim() ?? 'no message'}`
    : 'the workflow failed without saying why';
  // Out of memory is the one failure that goes away by itself, once whatever
  // else held the GPU lets go.
  const retryable = /out of memory|MPS backend out of memory/i.test(detail);
  return new AiError(`ComfyUI: ${detail}`, { retryable });
}

/** Every file a node saved, previews last — they are what a graph shows, not what it keeps. */
export function outputFiles(entry: HistoryEntry): ComfyFile[] {
  const files: ComfyFile[] = [];
  for (const output of Object.values(entry.outputs ?? {})) {
    for (const value of Object.values(output)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (item && typeof item === 'object' && typeof (item as ComfyFile).filename === 'string') {
          const file = item as ComfyFile;
          files.push({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' });
        }
      }
    }
  }
  return files.sort((a, b) => Number(a.type === 'temp') - Number(b.type === 'temp'));
}

// ---------------------------------------------------------------- provider

export class ComfyUiProvider implements AiProvider, ImageEditingProvider, VideoGenerationProvider {
  readonly name = 'comfyui';
  readonly textModel = 'comfyui';
  readonly imageModel = 'comfyui';
  readonly model = 'comfyui';

  constructor(private readonly client = new ComfyClient(env.COMFYUI_URL)) {}

  isConfigured(): boolean {
    return Boolean(env.COMFYUI_URL);
  }

  async complete(_input: { messages: AiMessage[] }): Promise<AiTextResult> {
    throw new AiError('ComfyUI generates media only; set AI_PROVIDER for text.');
  }

  async completeObject<T>(_input: { messages: AiMessage[] }): Promise<AiObjectResult<T>> {
    throw new AiError('ComfyUI generates media only; set AI_PROVIDER for text.');
  }

  async generateImage(input: {
    onStage?: (stage: string) => void;
    prompt: string;
    size?: ImageSize;
    references?: AiImageReference[];
  }): Promise<AiImageResult> {
    const [width, height] = (input.size ?? '1024x1024').split('x').map(Number);
    const result = await this.render({
      operation: 'txt2img',
      want: 'image',
      prompt: input.prompt,
      references: input.references ?? [],
      // Diffusion models work in latent tiles, and a size off the grid is
      // either refused or quietly cropped. 1820 is what 9:16 at 1024 wide
      // comes to, and 1824 is the nearest a model can actually make.
      values: { width: toGrid(width), height: toGrid(height), ...baseSize(width, height) },
      onStage: input.onStage,
    });
    return { data: result.data, mimeType: result.mimeType, model: result.model, usage: {} };
  }

  async editImage(input: { prompt: string; image: Buffer; mimeType: string }): Promise<AiMediaResult> {
    return this.withDimensions(await this.render({
      operation: 'edit', want: 'image', prompt: input.prompt, image: input, references: [], values: {},
    }));
  }

  async createVariation(input: { image: Buffer; mimeType: string; prompt?: string }): Promise<AiMediaResult> {
    return this.withDimensions(await this.render({
      operation: 'variation', want: 'image', prompt: input.prompt ?? '', image: input, references: [], values: {},
    }));
  }

  async generateVideo(input: { prompt: string; image?: Buffer; onStage?: (stage: string) => void; shouldStop?: () => Promise<boolean> } & VideoClipOptions): Promise<AiMediaResult> {
    if (input.image) return this.animateImage({ ...input, image: input.image });
    return this.render({ operation: 'txt2vid', want: 'video', prompt: input.prompt, references: [], values: clipValues(input), sound: input.sound, onStage: input.onStage, shouldStop: input.shouldStop });
  }

  async animateImage(input: { prompt: string; image: Buffer; onStage?: (stage: string) => void; shouldStop?: () => Promise<boolean> } & VideoClipOptions): Promise<AiMediaResult> {
    const mimeType = (await sharp(input.image).metadata().catch(() => null))?.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const result = await this.render({
      // A loop ends on the frame it starts on, which also keeps the framing
      // from drifting into a zoom.
      operation: input.loop ? 'img2vid_loop' : 'img2vid', want: 'video', prompt: input.prompt, image: { image: input.image, mimeType }, references: [], values: clipValues(input), sound: input.sound, onStage: input.onStage, shouldStop: input.shouldStop,
    });
    if (!crossfadesLoop(input)) return result;
    // A loose loop ends near, not on, its first frame; the dissolve hides the
    // difference, and the extra frames rendered for it keep the clip's length.
    const length = result.durationSeconds ?? Number(clipValues(input).frames) / CLIP_FPS;
    input.onStage?.('joining the loop');
    return {
      ...result,
      data: await loopCrossfade(result.data, length, LOOP_FADE_SECONDS),
      durationSeconds: length - LOOP_FADE_SECONDS,
    };
  }

  private async render(input: {
    operation: ComfyOperation;
    want: 'image' | 'video';
    prompt: string;
    image?: { image: Buffer; mimeType: string };
    references: AiImageReference[];
    values: Record<string, string | number>;
    /** False leaves the generated soundtrack out; the saved video is silent. */
    sound?: boolean;
    onStage?: (stage: string) => void;
    shouldStop?: () => Promise<boolean>;
  }): Promise<AiMediaResult> {
    if (!this.isConfigured()) {
      throw new AiError('ComfyUI runs only on the local worker. Start it with `npm run worker:local` on the machine running ComfyUI.');
    }
    const template = pickTemplate(
      await loadTemplates(),
      input.operation,
      new Set(input.references.map((reference) => reference.role)),
    );

    input.onStage?.('uploading inputs');
    // The camera-lock LoRA answers to its own trigger words, which mean
    // nothing to a workflow that does not load it.
    const locked = Number(input.values.camera_lock ?? 0) > 0 && [...template.placeholders].includes('camera_lock');
    const values: Record<string, string | number> = {
      prompt: locked ? `${CAMERA_LOCK_PROMPT} ${input.prompt}` : input.prompt,
      negative_prompt: '',
      seed: Math.floor(Math.random() * 2 ** 32),
      ...input.values,
    };
    if (input.image) values.image = await this.client.upload(input.image.image, input.image.mimeType);
    for (const role of template.roles) {
      // First of each role. Nothing sends two of one role today, and a graph
      // with one slot for it could not take a second anyway.
      const reference = input.references.find((candidate) => candidate.role === role);
      if (reference) values[ROLE_PLACEHOLDERS[role]] = await this.client.upload(reference.data, reference.mimeType);
    }

    const clientId = randomUUID();
    const full = fillTemplate(template, values);
    // With sound off the soundtrack would only be thrown away, so the sound
    // half of the graph is not run at all. Should ComfyUI refuse the trimmed
    // graph, the full one runs instead: the clip matters more than the saving.
    const silent = input.want === 'video' && input.sound === false && !soundlessRefused ? withoutSoundBranch(full) : null;
    const queueAndWait = async (graph: Record<string, unknown>) => {
      const promptId = await this.client.queue(graph, clientId);
      return this.client.wait(promptId, clientId, {
        timeoutMs: env.COMFYUI_TIMEOUT_MS,
        graph,
        onStage: input.onStage,
        shouldStop: input.shouldStop,
      });
    };
    let files: ComfyFile[];
    try {
      files = await queueAndWait(silent ?? full);
    } catch (error) {
      if (!silent || /cancelled/i.test(error instanceof Error ? error.message : '')) throw error;
      // Refused once, refused always: the model cannot run without sound, so
      // later clips go straight to the full workflow instead of losing time.
      soundlessRefused = true;
      console.warn('[comfyui] the workflow without sound was refused; running it whole from now on', error);
      files = await queueAndWait(full);
    }

    const wanted = input.want === 'video' ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS;
    const file = files.find((candidate) => wanted.has(extname(candidate.filename).toLowerCase()));
    if (!file) {
      throw new AiError(
        `ComfyUI workflow ${template.name}.json finished without saving ${input.want === 'video' ? 'a video' : 'an image'}. `
          + `Make sure it ends in a ${input.want === 'video' ? 'video' : 'Save Image'} node.`,
      );
    }
    input.onStage?.('downloading result');
    const extension = extname(file.filename).toLowerCase();
    let data = await this.client.download(file);
    const sound = input.want === 'video' && input.sound !== false
      ? files.find((candidate) => AUDIO_EXTENSIONS.has(extname(candidate.filename).toLowerCase()))
      : undefined;
    if (sound && extension === '.mp4') data = await withSoundtrack(data, await this.client.download(sound), extname(sound.filename));
    return {
      data,
      mimeType: MIME_TYPES[extension],
      extension: extension.slice(1),
      model: `comfyui:${template.name}`,
      // Known from what was asked for, so it is stored with the clip and nothing
      // downstream has to open the file to find it.
      ...(input.want === 'video' && input.values?.frames
        ? { durationSeconds: Number(input.values.frames) / CLIP_FPS }
        : {}),
    };
  }

  /** Measured rather than assumed, as the media job does for generated images. */
  private async withDimensions(result: AiMediaResult): Promise<AiMediaResult> {
    const probed = await sharp(result.data).metadata().catch(() => null);
    return { ...result, width: probed?.width, height: probed?.height };
  }
}

/** Frames per second the shipped video workflows render at; {{frames}} assumes it. */
const CLIP_FPS = 24;
const DEFAULT_CLIP_SECONDS = 4;

/**
 * How firmly the first frame holds the still in LTX's draft pass. A minor
 * lever: measured between the two extremes it changed almost nothing, since
 * LTX takes its motion from the prompt, which is where the Animate image
 * step says the amount (withMotion). Kept so a subtle clip also drifts less.
 */
const MOTION_STRENGTH: Record<AnimationMotion, number> = {
  subtle: 0.85,
  natural: 0.7,
  lively: 0.5,
};

/**
 * Length and motion as workflow values.
 *
 * `{{frames}}` is one more than a multiple of eight, which is what LTX's
 * latent wants, and whole seconds at 24 fps always are. A workflow that does
 * not use these simply ignores them.
 */
export function clipValues(options: VideoClipOptions): Record<string, number> {
  const seconds = Math.max(1, Math.round(options.seconds ?? DEFAULT_CLIP_SECONDS));
  return {
    seconds,
    // Extra frames for the dissolve a loose loop is joined with, so the clip
    // still runs the length asked for once they overlap.
    frames: seconds * CLIP_FPS + (crossfadesLoop(options) ? LOOP_FADE_FRAMES : 0) + 1,
    loop_strength: Math.min(100, Math.max(0, options.loopStrictness ?? 100)) / 100,
    motion_strength: MOTION_STRENGTH[options.motion ?? 'natural'],
    // 0 leaves the LoRA loaded but doing nothing, so one workflow serves both.
    camera_lock: options.stillCamera ? CAMERA_LOCK_STRENGTH : 0,
  };
}

/** Frames a loose loop's seam is dissolved over; a multiple of 8, as LTX needs. */
const LOOP_FADE_FRAMES = 16;
const LOOP_FADE_SECONDS = LOOP_FADE_FRAMES / CLIP_FPS;

/** A loop that does not have to end exactly on its first frame gets its seam dissolved. */
export function crossfadesLoop(options: VideoClipOptions): boolean {
  return Boolean(options.loop) && (options.loopStrictness ?? 100) < 100;
}

/**
 * Cinemagraph LoRA strength for a still camera. Its card recommends 1.0 to
 * 1.2, but at that strength it also freezes people, and these clips want small
 * movement in them; this is the lower end that still holds the camera.
 */
const CAMERA_LOCK_STRENGTH = 0.7;

/** The LoRA's own trigger words, which it was trained to respond to. */
const CAMERA_LOCK_PROMPT = 'CINEMAGRAPH_MOTION, tripod locked-off static camera, zero camera movement.';

/**
 * The same shape at about one megapixel, on a 64-pixel grid.
 *
 * What SDXL- and FLUX-class models were trained at. Asked for 1024x1820
 * directly they tend to repeat the subject down the frame; a workflow that
 * renders at this size and then upscales to {{width}}x{{height}} does not.
 */
export function baseSize(width: number, height: number): { base_width: number; base_height: number } {
  const scale = Math.sqrt((1024 * 1024) / (width * height));
  const snap = (value: number) => Math.max(512, Math.round((value * scale) / 64) * 64);
  return { base_width: snap(width), base_height: snap(height) };
}

/**
 * The clip with its soundtrack joined on.
 *
 * A workflow that makes sound saves it as its own file, because ComfyUI's own
 * muxer hands the whole soundtrack to the AAC encoder as one frame and the
 * encoder refuses it — the render finishes and then the save fails. ffmpeg does
 * the same join properly. Without ffmpeg the clip still arrives, silent, rather
 * than throwing away a render that took a quarter of an hour.
 */
async function withSoundtrack(video: Buffer, audio: Buffer, audioExtension: string): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'comfyui-mux-'));
  try {
    const [videoPath, audioPath, outPath] = ['video.mp4', `audio${audioExtension}`, 'out.mp4'].map((name) => join(directory, name));
    await writeFile(videoPath, video);
    await writeFile(audioPath, audio);
    await run('ffmpeg', ['-v', 'error', '-y', '-i', videoPath, '-i', audioPath, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outPath]);
    return await readFile(outPath);
  } catch (error) {
    console.warn('[comfyui] could not join the soundtrack; keeping the silent clip', error);
    return video;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function toGrid(value: number): number {
  return Math.max(64, Math.round(value / 16) * 16);
}

type ComfyMessage = {
  type?: string;
  data?: { prompt_id?: string; node?: string | null; value?: number; max?: number };
};

/**
 * The nodes that run a sampling pass, matched whole: KSamplerSelect only picks
 * a sampler and LTXVLatentUpsampler resizes, and neither is a pass.
 */
const SAMPLER = /^(KSampler|KSamplerAdvanced|SamplerCustom|SamplerCustomAdvanced)$/;

/** What a running node is doing, by its class, for the stages around sampling. */
const NODE_STAGES: [RegExp, string][] = [
  [/Loader|LoadCheckpoint|UNETLoader|CLIPLoader|VAELoader/i, 'loading models'],
  [/TextEncode/i, 'reading the prompt'],
  [/Upscale|Upsampler/i, 'upscaling'],
  [/Decode/i, 'making the frames'],
  [/Save|Preview/i, 'saving'],
];

/**
 * Turns ComfyUI's messages into a short phrase, or null when nothing changed.
 * Exported for its test: the phrasing is the whole point.
 */
export function progressDescriber(graph: Record<string, unknown>) {
  const classOf = (node: string | null | undefined) =>
    node ? String((graph[node] as { class_type?: unknown } | undefined)?.class_type ?? '') : '';
  const samplers = Object.keys(graph).filter((node) => SAMPLER.test(classOf(node)));
  const seen: string[] = [];
  let current: string | null = null;
  let last = '';
  return (message: ComfyMessage): string | null => {
    let stage: string | null = null;
    if (message.type === 'executing') {
      current = message.data?.node ?? null;
      const kind = classOf(current);
      if (current && SAMPLER.test(kind) && !seen.includes(current)) seen.push(current);
      stage = NODE_STAGES.find(([pattern]) => pattern.test(kind))?.[1] ?? null;
    } else if (message.type === 'progress') {
      const { value = 0, max = 0 } = message.data ?? {};
      if (!max) return null;
      const pass = samplers.length > 1 && seen.length
        ? `${passName(seen.length, samplers.length)}, `
        : '';
      stage = `${pass}step ${value} of ${max}`;
    }
    if (!stage || stage === last) return null;
    last = stage;
    return stage;
  };
}

/** Two passes read as draft and detail; more are numbered. */
function passName(pass: number, total: number): string {
  if (total === 2) return pass === 1 ? 'draft pass' : 'detail pass';
  return `pass ${pass} of ${total}`;
}

/** Set once ComfyUI refuses a workflow without its sound half, for the life of the worker. */
let soundlessRefused = false;

/** Nodes that only ever make or save sound. */
const SOUND_ONLY = new Set(['LTXVEmptyLatentAudio', 'LTXVAudioVAEDecode', 'SaveAudio']);

/**
 * The same workflow with its sound half removed.
 *
 * LTX workflows join a sound latent to the video before each sampling pass
 * and split it off after. Without sound, every reference to a join is pointed
 * at its video input and every reference to a split at what was split, the
 * sound nodes go, and whatever no longer feeds a saved output is dropped. The
 * picture is computed exactly as before; only the sound work disappears.
 * Exported for its test.
 */
export function withoutSoundBranch(graph: Record<string, unknown>): Record<string, unknown> {
  type Node = { class_type: string; inputs: Record<string, unknown> };
  const nodes = JSON.parse(JSON.stringify(graph)) as Record<string, Node>;
  const isRef = (value: unknown): value is [string, number] =>
    Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number';

  // What each join or split's video output really is.
  const replacement = new Map<string, unknown>();
  for (const [id, node] of Object.entries(nodes)) {
    if (node.class_type === 'LTXVConcatAVLatent') replacement.set(`${id}:0`, node.inputs.video_latent);
    if (node.class_type === 'LTXVSeparateAVLatent') replacement.set(`${id}:0`, node.inputs.av_latent);
  }
  const resolve = (value: unknown): unknown => {
    let current = value;
    for (let hops = 0; isRef(current) && replacement.has(`${current[0]}:${current[1]}`) && hops < 10; hops++) {
      current = replacement.get(`${current[0]}:${current[1]}`);
    }
    return current;
  };
  for (const node of Object.values(nodes)) {
    for (const [name, value] of Object.entries(node.inputs)) node.inputs[name] = resolve(value);
  }
  for (const [id, node] of Object.entries(nodes)) {
    if (SOUND_ONLY.has(node.class_type) || node.class_type === 'LTXVConcatAVLatent' || node.class_type === 'LTXVSeparateAVLatent') {
      delete nodes[id];
    }
  }

  // Keep only what still feeds a saved output.
  const keep = new Set<string>();
  const visit = (id: string) => {
    if (keep.has(id) || !nodes[id]) return;
    keep.add(id);
    for (const value of Object.values(nodes[id].inputs)) if (isRef(value)) visit(value[0]);
  };
  for (const [id, node] of Object.entries(nodes)) if (/^Save/.test(node.class_type)) visit(id);
  return Object.fromEntries(Object.entries(nodes).filter(([id]) => keep.has(id)));
}
