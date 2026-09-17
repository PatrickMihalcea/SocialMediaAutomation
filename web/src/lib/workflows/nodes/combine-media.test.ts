import { describe, expect, it, vi } from 'vitest';
import { run } from '@/lib/workflows/nodes/combine-media';
import type { NodeRunContext } from '@/lib/workflows/node-context';

const context = (inputs: Record<string, unknown>, sourceOrder = ['media1', 'media2', 'media3', 'media4']) => ({
  workspaceId: 'workspace-1',
  runId: 'run-1',
  nodeRunId: 'node-run-1',
  nodeId: 'node-1',
  nodeName: 'Combine',
  workflowName: 'Workflow',
  userId: null,
  attempt: 1,
  config: { sourceOrder },
  inputs,
  previousOutput: null,
  assertNotCancelled: vi.fn(),
  heartbeat: vi.fn(),
  saveProgress: vi.fn(),
  emitAssets: vi.fn(),
}) as NodeRunContext;

describe('Combine media', () => {
  it('concatenates sources and keeps titles aligned', async () => {
    await expect(run(context({
      media1: ['image-a', 'image-b'],
      titles1: ['A', 'B'],
      media2: ['video-c'],
    }))).resolves.toEqual({
      media: ['image-a', 'image-b', 'video-c'],
      titles: ['A', 'B', ''],
    });
  });

  it('respects configured source order', async () => {
    const result = await run(context(
      { media1: ['a'], media2: ['b'], media3: ['c'] },
      ['media3', 'media1', 'media2', 'media4'],
    ));
    expect(result.media).toEqual(['c', 'a', 'b']);
  });

  it('rejects titles that no longer align to their source', async () => {
    await expect(run(context({
      media1: ['a', 'b'],
      titles1: ['A'],
    }))).rejects.toThrow('2 items but 1 titles');
  });
});
