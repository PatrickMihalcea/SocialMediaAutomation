import { describe, expect, it, vi } from 'vitest';

import { run } from '@/lib/workflows/nodes/pick';
import type { NodeRunContext } from '@/lib/workflows/node-context';

function context(config: Record<string, unknown>, inputs: Record<string, unknown>): NodeRunContext {
  return {
    workspaceId: 'workspace-1',
    runId: 'run-1',
    nodeRunId: 'node-run-1',
    nodeId: 'node-1',
    nodeName: 'Select items',
    workflowName: 'Workflow',
    userId: null,
    attempt: 1,
    config,
    inputs,
    previousOutput: null,
    assertNotCancelled: vi.fn(),
    heartbeat: vi.fn(),
    saveProgress: vi.fn(),
    emitAssets: vi.fn(),
  };
}

const ITEMS = ['a', 'b', 'c', 'd', 'e'];
const LABELS = ['Attic', 'Barn', 'Cabin', 'Dock', 'Eaves'];

describe('select items step', () => {
  it('returns the selection and its first item', async () => {
    const output = await run(context({ mode: 'index', count: 2, index: 1 }, { items: ITEMS }));

    expect(output.selection).toEqual(['b', 'c']);
    expect(output.item).toBe('b');
    expect(output.labels).toEqual([]);
  });

  /**
   * The property the whole feature rests on. Media ids and the names belonging
   * to them travel as two lists, so a random selection applied to one and not
   * the other would put every name on the wrong clip — and the run would still
   * succeed.
   */
  it('keeps each label on its own item through a random selection', async () => {
    const output = await run(
      context({ mode: 'random', count: 3, index: 0 }, { items: ITEMS, labels: LABELS }),
    );

    const selection = output.selection as string[];
    const labels = output.labels as string[];
    expect(selection).toHaveLength(3);
    expect(labels).toHaveLength(3);
    selection.forEach((item, position) => {
      expect(labels[position]).toBe(LABELS[ITEMS.indexOf(item)]);
    });
  });

  it('reorders labels with an index selection too', async () => {
    const output = await run(
      context({ mode: 'last', count: 2, index: 0 }, { items: ITEMS, labels: LABELS }),
    );

    expect(output.selection).toEqual(['d', 'e']);
    expect(output.labels).toEqual(['Dock', 'Eaves']);
  });

  // Trimming to fit would shift every label by one and still render a video.
  it('refuses a label list that does not match the items', async () => {
    await expect(
      run(context({ mode: 'first', count: 2, index: 0 }, { items: ITEMS, labels: ['Attic'] })),
    ).rejects.toThrow('received 5 items but 1 labels');
  });

  it('refuses an empty input list', async () => {
    await expect(run(context({ mode: 'first', count: 1, index: 0 }, { items: [] })))
      .rejects.toThrow('Nothing reached this step');
  });

  it('reports asking for more items than arrived', async () => {
    await expect(run(context({ mode: 'random', count: 9, index: 0 }, { items: ITEMS })))
      .rejects.toThrow('needs 9 items, but only 5 arrived');
  });
});

/**
 * The run row shows what a step produced, and this step produced a choice —
 * which was the one thing a run never said about it. Reading uuids back out of
 * the output panel tells nobody which pictures a random draw landed on.
 */
describe('what it chose is shown on the run', () => {
  it('emits the selected items, in the order it selected them', async () => {
    const ctx = context({ mode: 'index', count: 3, index: 1 }, { items: ITEMS });

    await run(ctx);

    expect(ctx.emitAssets).toHaveBeenCalledWith('selection', ['b', 'c', 'd']);
  });

  it('emits nothing when it selected nothing', async () => {
    const ctx = context({ mode: 'index', count: 1, index: 0 }, { items: [undefined] as unknown as string[] });

    await run(ctx);

    expect(ctx.emitAssets).not.toHaveBeenCalled();
  });
});
