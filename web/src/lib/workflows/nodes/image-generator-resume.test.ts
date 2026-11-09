import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  mediaAssetCreate: vi.fn(),
  put: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({ generateImage: mocks.generateImage }));
vi.mock('@/lib/db', () => ({ db: { mediaAsset: { create: mocks.mediaAssetCreate, findFirst: vi.fn() } } }));
vi.mock('@/lib/storage', () => ({
  mediaKey: (_workspace: string, filename: string) => `key/${filename}`,
  storage: () => ({ put: mocks.put, get: vi.fn() }),
}));

import { run } from '@/lib/workflows/nodes/image-generator';
import type { NodeRunContext } from '@/lib/workflows/node-context';

const PROMPTS = ['one', 'two', 'three', 'four'];

function context(previousOutput: Record<string, unknown> | null): NodeRunContext {
  return {
    workspaceId: 'workspace-1',
    runId: 'run-1',
    nodeRunId: 'node-run-1',
    nodeId: 'node-1',
    nodeName: 'Render scenes',
    workflowName: 'Workflow',
    userId: 'user-1',
    attempt: 1,
    config: { size: '1024x1536', style: '', maxImages: 8, provider: 'mock', useMockGeneration: false },
    inputs: { prompts: PROMPTS },
    previousOutput,
    assertNotCancelled: vi.fn(),
    heartbeat: vi.fn(),
    saveProgress: vi.fn(),
    emitAssets: vi.fn(),
  } as unknown as NodeRunContext;
}

/**
 * The failures this exists for are the provider's, not the prompt's — a stream
 * that carried no picture, or one that outran its own time budget. Sending the
 * same prompt again usually works, and the images already paid for must not be
 * thrown away to find that out.
 */
describe('resuming a part-finished image step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let made = 0;
    mocks.generateImage.mockImplementation(async () => ({
      data: Buffer.from('png'),
      mimeType: 'image/png',
      generationId: `gen-${++made}`,
    }));
    let created = 0;
    mocks.mediaAssetCreate.mockImplementation(async () => ({ id: `asset-${++created}` }));
  });

  it('starts from the beginning when nothing ran before', async () => {
    const output = await run(context(null));

    expect(mocks.generateImage).toHaveBeenCalledTimes(4);
    expect(output.images).toEqual(['asset-1', 'asset-2', 'asset-3', 'asset-4']);
  });

  it('asks only for the images still missing', async () => {
    const ctx = context({ images: ['kept-1', 'kept-2'], _progress: { done: 2, total: 4 } });

    const output = await run(ctx);

    // Two already there, so two calls — not four.
    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
    expect(mocks.generateImage).toHaveBeenNthCalledWith(1, expect.objectContaining({ prompt: 'three' }));
    expect(output.images).toEqual(['kept-1', 'kept-2', 'asset-1', 'asset-2']);
  });

  it('records progress after every image, so a crash on the next one costs nothing', async () => {
    const ctx = context(null);

    await run(ctx);

    // Twice per image: once on starting it, so a picture that never comes
    // back is visible while it is happening rather than only afterwards, and
    // once on finishing it.
    expect(ctx.saveProgress).toHaveBeenCalledTimes(8);
    expect(ctx.saveProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ _progress: expect.objectContaining({ done: 4, total: 4 }) }),
    );
  });

  /** A refusal is the model declining one try; the same prompt usually draws next time. */
  it('tries a refused picture again straight away instead of failing the step', async () => {
    mocks.generateImage
      .mockRejectedValueOnce(new Error('image-use exited with 1: no image returned; the model replied instead: "I can\'t."'))
      .mockResolvedValue({ data: Buffer.from('a'), mimeType: 'image/png', generationId: 'g1' });
    const ctx = context(null);

    const output = await run(ctx);

    expect((output as { images: string[] }).images).toHaveLength(4);
  });

  /** The whole point: a failure part-way keeps what came before it. */
  it('keeps the finished images when a later one fails', async () => {
    mocks.generateImage
      .mockResolvedValueOnce({ data: Buffer.from('a'), mimeType: 'image/png', generationId: 'g1' })
      .mockResolvedValueOnce({ data: Buffer.from('b'), mimeType: 'image/png', generationId: 'g2' })
      .mockRejectedValueOnce(new Error('image-use exited with 1: timed out'));
    const ctx = context(null);

    await expect(run(ctx)).rejects.toThrow(/timed out/);

    const saved = (ctx.saveProgress as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(saved.images).toEqual(['asset-1', 'asset-2']);
    expect(saved._progress).toMatchObject({ done: 2, total: 4 });
  });

  it('resumes exactly where that failure left off', async () => {
    const output = await run(context({ images: ['asset-1', 'asset-2'], _progress: { done: 2, total: 4 } }));

    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
    expect(output.images).toHaveLength(4);
  });
});

/**
 * One call can legitimately take minutes, and for the whole of it the step
 * used to show the same number — so a picture being made and a picture wedged
 * looked identical from the outside. The provider narrates itself; the step
 * writes down what it says.
 */
describe('saying what it is doing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let created = 0;
    mocks.mediaAssetCreate.mockImplementation(async () => ({ id: `asset-${++created}` }));
  });

  it('records the stage the provider reports, as it reports it', async () => {
    mocks.generateImage.mockImplementation(async ({ onStage }) => {
      onStage?.('queued');
      onStage?.('generating');
      return { data: Buffer.from('png'), mimeType: 'image/png', generationId: 'g1' };
    });
    const ctx = context(null);

    await run(ctx);

    const stages = (ctx.saveProgress as ReturnType<typeof vi.fn>).mock.calls
      .map(([saved]) => saved._progress?.stage)
      .filter(Boolean);
    expect(stages).toContain('queued');
    expect(stages).toContain('generating');
  });

  it('says when the picture in hand was started, so a wait can be measured', async () => {
    mocks.generateImage.mockResolvedValue({ data: Buffer.from('png'), mimeType: 'image/png', generationId: 'g1' });
    const ctx = context(null);

    await run(ctx);

    const [first] = (ctx.saveProgress as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(typeof first._progress.since).toBe('number');
  });

  /** A provider with nothing to say about itself must still work. */
  it('copes with a provider that never reports a stage', async () => {
    mocks.generateImage.mockResolvedValue({ data: Buffer.from('png'), mimeType: 'image/png', generationId: 'g1' });

    const output = await run(context(null));

    expect(output.images).toHaveLength(4);
  });
});

/**
 * Codex and the API take a minute an image and do not mind company, so a set
 * of eight was eight minutes of waiting on one call at a time. ComfyUI is one
 * GPU that a render already fills, so it stays one at a time.
 */
describe('making pictures side by side', () => {
  function withProvider(provider: string, previousOutput: Record<string, unknown> | null = null, prompts = PROMPTS) {
    const ctx = context(previousOutput);
    (ctx as unknown as { config: Record<string, unknown> }).config = { ...(ctx.config as Record<string, unknown>), provider };
    (ctx as unknown as { inputs: Record<string, unknown> }).inputs = { prompts };
    return ctx;
  }

  /** A provider whose calls finish only when told to, in any order. */
  function heldProvider() {
    const waiting: Array<{ prompt: string; finish: () => void; fail: (error: Error) => void }> = [];
    let peak = 0;
    let running = 0;
    mocks.generateImage.mockImplementation(({ prompt }: { prompt: string }) => {
      running += 1;
      peak = Math.max(peak, running);
      return new Promise((resolve, reject) => {
        waiting.push({
          prompt,
          finish: () => { running -= 1; resolve({ data: Buffer.from(prompt), mimeType: 'image/png', generationId: `gen-${prompt}` }); },
          fail: (error) => { running -= 1; reject(error); },
        });
      });
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    return { waiting, peak: () => peak, settle };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mediaAssetCreate.mockImplementation(async ({ data }: { data: { altText: string } }) => ({ id: `asset-${data.altText.split('\n')[0]}` }));
  });

  it('runs up to four Codex pictures at once', async () => {
    const held = heldProvider();
    const prompts = ['a', 'b', 'c', 'd', 'e', 'f'];
    const done = run(withProvider('image-use', null, prompts));

    await held.settle();
    expect(held.waiting).toHaveLength(4);
    for (let index = 0; index < prompts.length; index++) {
      held.waiting.shift()!.finish();
      await held.settle();
    }
    const output = await done;

    expect(held.peak()).toBe(4);
    expect(output.images).toEqual(prompts.map((prompt) => `asset-${prompt}`));
  });

  it('keeps the prompt order when pictures finish out of order', async () => {
    const held = heldProvider();
    const done = run(withProvider('image-use'));

    await held.settle();
    for (const call of [...held.waiting].reverse()) {
      call.finish();
      await held.settle();
    }
    const output = await done;

    expect(output.images).toEqual(['asset-one', 'asset-two', 'asset-three', 'asset-four']);
  });

  it('saves the pictures that finished beside a failure, and leaves the gap for the retry', async () => {
    const held = heldProvider();
    const ctx = withProvider('image-use');
    const done = run(ctx);

    await held.settle();
    const [one, two, three, four] = held.waiting;
    two.fail(new Error('image-use exited with 1: timed out'));
    one.finish();
    three.finish();
    four.finish();

    await expect(done).rejects.toThrow(/timed out/);
    const saved = (ctx.saveProgress as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(saved._slots).toEqual(['asset-one', null, 'asset-three', 'asset-four']);
    expect(saved._progress).toMatchObject({ done: 3, total: 4 });

    // The retry asks for the one missing picture and slots it back in place.
    mocks.generateImage.mockReset();
    mocks.generateImage.mockResolvedValue({ data: Buffer.from('two'), mimeType: 'image/png', generationId: 'g' });
    const output = await run(withProvider('image-use', saved));
    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.generateImage).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'two' }));
    expect(output.images).toEqual(['asset-one', 'asset-two', 'asset-three', 'asset-four']);
  });

  it('keeps ComfyUI to one picture at a time', async () => {
    const held = heldProvider();
    const done = run(withProvider('comfyui'));

    for (let index = 0; index < PROMPTS.length; index++) {
      await held.settle();
      expect(held.waiting).toHaveLength(1);
      held.waiting.shift()!.finish();
    }
    await done;

    expect(held.peak()).toBe(1);
  });
});
