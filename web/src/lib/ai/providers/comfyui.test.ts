import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: { COMFYUI_URL: '', COMFYUI_WORKFLOWS_DIR: '', COMFYUI_TIMEOUT_MS: 10_000 },
}));

import {
  progressDescriber,
  baseSize,
  clipValues,
  ComfyClient,
  ComfyUiProvider,
  fillTemplate,
  loadTemplates,
  outputFiles,
  pickTemplate,
  type ComfyTemplate,
} from '@/lib/ai/providers/comfyui';
import { AiError } from '@/lib/ai/types';
import { env } from '@/lib/env';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const MP4 = Buffer.from('000000186674797069736f6d', 'hex');

const template = (name: string, graph: Record<string, unknown>): ComfyTemplate => {
  const text = JSON.stringify(graph);
  const placeholders = new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]));
  const roles = new Set((['subject', 'style', 'composition'] as const).filter((role) => placeholders.has(`${role}_image`)));
  return { name, operation: name.split('-')[0] as ComfyTemplate['operation'], roles, placeholders, graph };
};

describe('picking a workflow file', () => {
  const plain = template('txt2img', { '1': { inputs: { text: '{{prompt}}' } } });
  const style = template('txt2img-style', { '1': { inputs: { image: '{{style_image}}' } } });
  const both = template('txt2img-subject-style', { '1': { inputs: { a: '{{subject_image}}', b: '{{style_image}}' } } });
  const all = [plain, style, both, template('img2vid', {})];

  it('uses the plain file when no references are sent', () => {
    expect(pickTemplate(all, 'txt2img', new Set()).name).toBe('txt2img');
  });

  it('uses the file that takes the most of the references on offer', () => {
    expect(pickTemplate(all, 'txt2img', new Set(['style'])).name).toBe('txt2img-style');
    expect(pickTemplate(all, 'txt2img', new Set(['style', 'subject'])).name).toBe('txt2img-subject-style');
  });

  it('never picks a file that wants a picture the call does not have', () => {
    expect(pickTemplate(all, 'txt2img', new Set(['subject'])).name).toBe('txt2img');
  });

  it('names the file to create when the operation has none', () => {
    expect(() => pickTemplate(all, 'edit', new Set())).toThrow(/save it as edit\.json/);
  });
});

describe('filling a workflow in', () => {
  it('turns a whole-value placeholder into the value itself, typed', () => {
    const filled = fillTemplate(
      template('txt2img', { '5': { inputs: { width: '{{width}}', text: 'a photo of {{prompt}}, sharp' } } }),
      { width: 1024, prompt: 'a cat' },
    );
    expect(filled).toEqual({ '5': { inputs: { width: 1024, text: 'a photo of a cat, sharp' } } });
  });

  it('refuses a file asking for something the operation does not supply', () => {
    expect(() => fillTemplate(template('txt2img', { '1': { inputs: { x: '{{frames}}' } } }), {}))
      .toThrow(/\{\{frames\}\}/);
  });
});

describe('the base size a model was trained at', () => {
  it('keeps the shape at about a megapixel', () => {
    expect(baseSize(1024, 1820)).toEqual({ base_width: 768, base_height: 1344 });
    expect(baseSize(1024, 1024)).toEqual({ base_width: 1024, base_height: 1024 });
    expect(baseSize(1536, 1024)).toEqual({ base_width: 1280, base_height: 832 });
  });
});

describe('clip length and motion', () => {
  it('turns seconds into a frame count LTX accepts, one more than a multiple of eight', () => {
    for (const seconds of [2, 3, 4, 5, 6]) {
      const { frames } = clipValues({ seconds });
      expect(frames).toBe(seconds * 24 + 1);
      expect((frames - 1) % 8).toBe(0);
    }
  });

  it('defaults to four seconds of natural motion, what the workflows rendered before either was a setting', () => {
    expect(clipValues({})).toEqual({ seconds: 4, frames: 97, motion_strength: 0.7 });
  });

  it('holds the still more firmly the subtler the motion', () => {
    const strength = (motion: 'subtle' | 'natural' | 'lively') => clipValues({ motion }).motion_strength;
    expect(strength('subtle')).toBeGreaterThan(strength('natural'));
    expect(strength('natural')).toBeGreaterThan(strength('lively'));
  });
});

describe('loading workflow files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'comfy-templates-'));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it('reads roles off the placeholders and ignores files for no known operation', async () => {
    writeFileSync(join(directory, 'txt2img-style.json'), JSON.stringify({ '1': { inputs: { image: '{{style_image}}' } } }));
    writeFileSync(join(directory, 'notes.json'), '{}');
    const templates = await loadTemplates(directory);
    expect(templates.map((t) => t.name)).toEqual(['txt2img-style']);
    expect([...templates[0].roles]).toEqual(['style']);
  });

  it('says so when a file was saved in the editor format instead of the API one', async () => {
    writeFileSync(join(directory, 'edit.json'), JSON.stringify({ nodes: [], links: [] }));
    await expect(loadTemplates(directory)).rejects.toThrow(/Export \(API\)/);
    rmSync(join(directory, 'edit.json'));
  });
});

describe('reading what a prompt saved', () => {
  it('collects files from any output key and puts previews last', () => {
    const files = outputFiles({
      outputs: {
        '9': { images: [{ filename: 'preview.png', subfolder: '', type: 'temp' }] },
        '12': { gifs: [{ filename: 'clip.mp4', subfolder: 'video', type: 'output' }] },
      },
    });
    expect(files.map((file) => file.filename)).toEqual(['clip.mp4', 'preview.png']);
  });
});

/**
 * A stand-in ComfyUI on a real socket.
 *
 * The provider's contract is entirely the HTTP conversation — what it posts to
 * /prompt, that it waits on /history, that it fetches the saved file through
 * /view — so it is tested against a server rather than a mocked fetch.
 */
describe('ComfyUiProvider against a ComfyUI server', () => {
  let server: Server;
  let baseUrl = '';
  const directory = mkdtempSync(join(tmpdir(), 'comfy-provider-'));
  let posted: Record<string, unknown> | null = null;
  let uploads = 0;
  let mode: 'ok' | 'refuse' | 'fail' = 'ok';
  let pollsBeforeDone = 0;

  beforeAll(async () => {
    writeFileSync(join(directory, 'txt2img.json'), JSON.stringify({
      '3': { class_type: 'KSampler', inputs: { seed: '{{seed}}' } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}' } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
    }));
    writeFileSync(join(directory, 'img2vid.json'), JSON.stringify({
      '1': { class_type: 'LoadImage', inputs: { image: '{{image}}' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
      '3': { class_type: 'EmptyLTXVLatentVideo', inputs: { length: '{{frames}}' } },
      '4': { class_type: 'LTXVImgToVideoInplace', inputs: { strength: '{{motion_strength}}' } },
    }));
    server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://x');
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      if (url.pathname === '/prompt') {
        posted = JSON.parse(await body(request)) as Record<string, unknown>;
        if (mode === 'refuse') {
          return send(400, {
            error: { message: 'Prompt outputs failed validation' },
            node_errors: { '4': { class_type: 'CheckpointLoaderSimple', errors: [{ message: 'Value not in list', details: 'ckpt_name: flux.safetensors' }] } },
          });
        }
        return send(200, { prompt_id: 'p1', number: 1 });
      }
      if (url.pathname === '/upload/image') {
        uploads += 1;
        await body(request);
        return send(200, { name: 'still.png', subfolder: 'bridge88', type: 'input' });
      }
      if (url.pathname === '/history/p1') {
        if (pollsBeforeDone-- > 0) return send(200, {});
        if (mode === 'fail') {
          return send(200, { p1: { outputs: {}, status: { status_str: 'error', completed: false, messages: [['execution_error', { node_type: 'KSampler', exception_message: 'MPS backend out of memory' }]] } } });
        }
        const video = (posted?.prompt as Record<string, unknown>)?.['1'] !== undefined;
        return send(200, {
          p1: {
            outputs: video
              ? { '9': { gifs: [{ filename: 'clip.mp4', subfolder: '', type: 'output' }] }, '10': { audio: [{ filename: 'sound.flac', subfolder: '', type: 'output' }] } }
              : { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
            status: { status_str: 'success', completed: true, messages: [] },
          },
        });
      }
      if (url.pathname === '/queue') return send(200, { queue_running: [[1, 'p1']], queue_pending: [] });
      if (url.pathname === '/view') {
        response.writeHead(200);
        return response.end(url.searchParams.get('filename') === 'clip.mp4' ? MP4 : PNG);
      }
      if (url.pathname === '/system_stats') return send(200, {});
      send(404, {});
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    Object.assign(env, { COMFYUI_URL: baseUrl, COMFYUI_WORKFLOWS_DIR: directory });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });

  beforeEach(() => {
    posted = null;
    uploads = 0;
    mode = 'ok';
    pollsBeforeDone = 0;
  });

  it('fills the graph in, waits for history and returns the saved image', async () => {
    pollsBeforeDone = 1;
    const stages: string[] = [];
    const result = await new ComfyUiProvider().generateImage({
      prompt: 'a lighthouse at dusk',
      size: '1024x1820',
      onStage: (stage) => stages.push(stage),
    });
    const graph = posted?.prompt as Record<string, { inputs: Record<string, unknown> }>;
    expect(graph['6'].inputs.text).toBe('a lighthouse at dusk');
    // 1820 is off the latent grid; the nearest a model can make is 1824.
    expect(graph['5'].inputs).toEqual({ width: 1024, height: 1824 });
    expect(typeof graph['3'].inputs.seed).toBe('number');
    expect(result).toMatchObject({ data: PNG, mimeType: 'image/png', model: 'comfyui:txt2img' });
    expect(stages).toContain('rendering');
  });

  /**
   * The soundtrack comes back as its own file and is joined with ffmpeg. These
   * bytes are not a real clip, so the join fails, and what this pins down is
   * the fallback: a render that took a quarter of an hour arrives silent rather
   * than not at all.
   */
  it('uploads the still and returns the clip for an animation, silent if the sound cannot be joined', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await new ComfyUiProvider().animateImage({ prompt: 'slow push in', image: PNG, seconds: 6, motion: 'lively' });
    const graph = posted?.prompt as Record<string, { inputs: Record<string, unknown> }>;
    expect(uploads).toBe(1);
    expect(graph['1'].inputs.image).toBe('bridge88/still.png');
    expect(graph['3'].inputs.length).toBe(145);
    expect(graph['4'].inputs.strength).toBe(0.5);
    expect(result).toMatchObject({ data: MP4, mimeType: 'video/mp4', extension: 'mp4', model: 'comfyui:img2vid' });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not join the soundtrack/), expect.anything());
    warn.mockRestore();
  });

  it('passes on what ComfyUI said when it refuses the graph, and does not retry it', async () => {
    mode = 'refuse';
    const error = await new ComfyUiProvider().generateImage({ prompt: 'x' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).message).toMatch(/CheckpointLoaderSimple: Value not in list ckpt_name: flux\.safetensors/);
    expect((error as AiError).retryable).toBe(false);
  });

  it('retries a render that ran out of memory', async () => {
    mode = 'fail';
    const error = await new ComfyUiProvider().generateImage({ prompt: 'x' }).catch((caught: unknown) => caught);
    expect((error as AiError).message).toMatch(/KSampler failed: MPS backend out of memory/);
    expect((error as AiError).retryable).toBe(true);
  });

  it('treats a closed ComfyUI as something to wait out, not a broken job', async () => {
    const client = new ComfyClient('http://127.0.0.1:1');
    expect(await client.ping()).toBe(false);
    const error = await client.queue({}, 'c').catch((caught: unknown) => caught);
    expect((error as AiError).retryable).toBe(true);
    expect((error as AiError).message).toMatch(/Is it running\?/);
  });
});

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

describe('describing ComfyUI progress', () => {
  // The shape of the shipped image-to-video workflow: two sampling passes
  // around a decode.
  const graph = {
    '1': { class_type: 'CheckpointLoaderSimple' },
    '5': { class_type: 'CLIPTextEncode' },
    '10': { class_type: 'SamplerCustomAdvanced' },
    '20': { class_type: 'LTXVLatentUpsampler' },
    '30': { class_type: 'SamplerCustomAdvanced' },
    '40': { class_type: 'VAEDecodeTiled' },
    '50': { class_type: 'SaveVideo' },
  };
  const run = (messages: { type: string; data: Record<string, unknown> }[]) => {
    const describe = progressDescriber(graph);
    return messages.map((message) => describe({ ...message, data: { prompt_id: 'p', ...message.data } })).filter(Boolean);
  };

  it('names the pass and step, and the stages around them', () => {
    expect(run([
      { type: 'executing', data: { node: '1' } },
      { type: 'executing', data: { node: '5' } },
      { type: 'executing', data: { node: '10' } },
      { type: 'progress', data: { value: 1, max: 8 } },
      { type: 'progress', data: { value: 8, max: 8 } },
      { type: 'executing', data: { node: '20' } },
      { type: 'executing', data: { node: '30' } },
      { type: 'progress', data: { value: 2, max: 3 } },
      { type: 'executing', data: { node: '40' } },
      { type: 'executing', data: { node: '50' } },
    ])).toEqual([
      'loading models',
      'reading the prompt',
      'draft pass, step 1 of 8',
      'draft pass, step 8 of 8',
      'upscaling',
      'detail pass, step 2 of 3',
      'making the frames',
      'saving',
    ]);
  });

  it('leaves the pass out of a one-pass workflow, and repeats nothing', () => {
    const describe = progressDescriber({ '3': { class_type: 'KSampler' } });
    const say = (value: number) => describe({ type: 'progress', data: { prompt_id: 'p', value, max: 15 } });
    expect(say(4)).toBe('step 4 of 15');
    expect(say(4)).toBeNull();
  });
});
