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

    expect(ctx.saveProgress).toHaveBeenCalledTimes(4);
    expect(ctx.saveProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ _progress: { done: 4, total: 4 } }),
    );
  });

  /** The whole point: a failure part-way keeps what came before it. */
  it('keeps the finished images when a later one fails', async () => {
    mocks.generateImage
      .mockResolvedValueOnce({ data: Buffer.from('a'), mimeType: 'image/png', generationId: 'g1' })
      .mockResolvedValueOnce({ data: Buffer.from('b'), mimeType: 'image/png', generationId: 'g2' })
      .mockRejectedValueOnce(new Error('image-use exited with 1: no image returned'));
    const ctx = context(null);

    await expect(run(ctx)).rejects.toThrow(/no image returned/);

    const saved = (ctx.saveProgress as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(saved.images).toEqual(['asset-1', 'asset-2']);
    expect(saved._progress).toEqual({ done: 2, total: 4 });
  });

  it('resumes exactly where that failure left off', async () => {
    const output = await run(context({ images: ['asset-1', 'asset-2'], _progress: { done: 2, total: 4 } }));

    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
    expect(output.images).toHaveLength(4);
  });
});
