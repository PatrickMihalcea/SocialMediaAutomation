import { describe, expect, it } from 'vitest';
import { selectItems } from '@/lib/workflows/select-items';

describe('selectItems', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('selects ordered ranges from either end', () => {
    expect(selectItems(items, { mode: 'first', count: 3, index: 0, seed: 'run' }))
      .toEqual(['a', 'b', 'c']);
    expect(selectItems(items, { mode: 'last', count: 2, index: 0, seed: 'run' }))
      .toEqual(['d', 'e']);
    expect(selectItems(items, { mode: 'index', count: 2, index: 1, seed: 'run' }))
      .toEqual(['b', 'c']);
    expect(selectItems(items, { mode: 'index', count: 1, index: -1, seed: 'run' }))
      .toEqual(['e']);
  });

  it('returns a repeatable random sample without duplicates', () => {
    const first = selectItems(items, { mode: 'random', count: 3, index: 0, seed: 'run:node' });
    const retry = selectItems(items, { mode: 'random', count: 3, index: 0, seed: 'run:node' });
    expect(retry).toEqual(first);
    expect(new Set(first).size).toBe(3);
  });

  it('changes the random sample when the node seed changes', () => {
    const first = selectItems(items, { mode: 'random', count: 3, index: 0, seed: 'run:node-a' });
    const second = selectItems(items, { mode: 'random', count: 3, index: 0, seed: 'run:node-b' });
    expect(second).not.toEqual(first);
  });

  it('rejects impossible counts and ranges', () => {
    expect(() => selectItems(items, { mode: 'random', count: 6, index: 0, seed: 'run' }))
      .toThrow('needs 6 items');
    expect(() => selectItems(items, { mode: 'index', count: 3, index: 4, seed: 'run' }))
      .toThrow('cannot be selected');
  });
});
