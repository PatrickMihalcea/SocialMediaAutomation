import { describe, expect, it } from 'vitest';
import {
  CycleError,
  assertAcyclic,
  descendantsOf,
  indegrees,
  reaches,
  rootsOf,
  topoOrder,
  type Graph,
} from '@/lib/workflows/graph';

const edge = (from: string, to: string) => ({
  sourceNodeId: from,
  sourcePort: 'out',
  targetNodeId: to,
  targetPort: 'in',
});

/**
 * The bedroom-video shape: idea fans out to images and music, both converge on
 * the slideshow, which feeds the overlay and then two publish targets.
 */
const diamond: Graph = {
  nodes: ['idea', 'images', 'music', 'slideshow', 'overlay', 'instagram', 'youtube'].map((id) => ({
    id,
    type: id,
  })),
  edges: [
    edge('idea', 'images'),
    edge('images', 'slideshow'),
    edge('music', 'slideshow'),
    edge('slideshow', 'overlay'),
    edge('overlay', 'instagram'),
    edge('overlay', 'youtube'),
  ],
};

describe('indegrees', () => {
  it('counts incoming edges, which is what seeds pendingDeps', () => {
    const counts = indegrees(diamond);
    expect(counts.get('idea')).toBe(0);
    expect(counts.get('music')).toBe(0);
    expect(counts.get('slideshow')).toBe(2);
    expect(counts.get('instagram')).toBe(1);
  });

  it('ignores an edge pointing outside the graph rather than counting it', () => {
    // A stale edge that counted would leave its target permanently un-runnable.
    const graph: Graph = { nodes: [{ id: 'a', type: 'a' }], edges: [edge('ghost', 'a')] };
    expect(indegrees(graph).get('a')).toBe(0);
  });
});

describe('rootsOf', () => {
  it('finds the nodes a run starts from', () => {
    expect(rootsOf(diamond).sort()).toEqual(['idea', 'music']);
  });
});

describe('topoOrder', () => {
  it('places every node after its dependencies', () => {
    const order = topoOrder(diamond);
    const at = (id: string) => order.indexOf(id);
    expect(at('idea')).toBeLessThan(at('images'));
    expect(at('images')).toBeLessThan(at('slideshow'));
    expect(at('music')).toBeLessThan(at('slideshow'));
    expect(at('slideshow')).toBeLessThan(at('overlay'));
    expect(order).toHaveLength(7);
  });

  it('throws naming the cycle', () => {
    const graph: Graph = {
      nodes: ['a', 'b', 'c'].map((id) => ({ id, type: id })),
      edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    };
    try {
      topoOrder(graph);
      expect.unreachable('a cycle should not produce an order');
    } catch (error) {
      expect(error).toBeInstanceOf(CycleError);
      expect((error as CycleError).nodeIds.sort()).toEqual(['a', 'b', 'c']);
    }
  });

  it('accepts a graph with no edges at all', () => {
    const graph: Graph = { nodes: [{ id: 'solo', type: 'solo' }], edges: [] };
    expect(topoOrder(graph)).toEqual(['solo']);
    expect(() => assertAcyclic(graph)).not.toThrow();
  });
});

describe('descendantsOf', () => {
  it('is transitive, so a failure skips the whole branch below it', () => {
    expect(descendantsOf(diamond, 'images').sort()).toEqual([
      'instagram',
      'overlay',
      'slideshow',
      'youtube',
    ]);
  });

  it('leaves a parallel branch alone', () => {
    // Music failing must not skip the image branch.
    expect(descendantsOf(diamond, 'music')).not.toContain('images');
  });

  it('excludes the node itself', () => {
    expect(descendantsOf(diamond, 'idea')).not.toContain('idea');
  });

  it('terminates on a cycle instead of looping forever', () => {
    const graph: Graph = {
      nodes: ['a', 'b'].map((id) => ({ id, type: id })),
      edges: [edge('a', 'b'), edge('b', 'a')],
    };
    expect(descendantsOf(graph, 'a').sort()).toEqual(['b']);
  });
});

describe('reaches', () => {
  it('detects the cycle a proposed edge would close', () => {
    // Connecting overlay back to idea would make the graph circular.
    expect(reaches(diamond.edges, 'idea', 'overlay')).toBe(true);
  });

  it('allows an edge between unrelated branches', () => {
    expect(reaches(diamond.edges, 'instagram', 'music')).toBe(false);
  });

  it('treats a self-connection as a cycle', () => {
    expect(reaches(diamond.edges, 'idea', 'idea')).toBe(true);
  });
});

describe('parallel edges between the same pair of nodes', () => {
  // The shape a generated pipeline actually has: the idea step writes the
  // draft's caption and its hashtags, so it feeds one step through several
  // ports at once. Counting those as separate dependencies would leave the
  // draft waiting forever on completions that can never come, and the graph
  // would read as cyclic.
  const twoEdges: Graph = {
    nodes: ['idea', 'draft'].map((id) => ({ id, type: id })),
    edges: [
      { sourceNodeId: 'idea', sourcePort: 'caption', targetNodeId: 'draft', targetPort: 'caption' },
      { sourceNodeId: 'idea', sourcePort: 'hashtags', targetNodeId: 'draft', targetPort: 'hashtags' },
    ],
  };

  it('counts one dependency, not two', () => {
    expect(indegrees(twoEdges).get('draft')).toBe(1);
  });

  it('orders without reporting a false cycle', () => {
    expect(topoOrder(twoEdges)).toEqual(['idea', 'draft']);
  });

  it('still reports the target as a descendant exactly once', () => {
    expect(descendantsOf(twoEdges, 'idea')).toEqual(['draft']);
  });
});
