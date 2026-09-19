import { describe, expect, it } from 'vitest';
import { MediaType } from '@prisma/client';
import {
  checkAddedEdge,
  checkEdge,
  checkGraphTypes,
  resolveOutputType,
  type ResolutionGraph,
} from '@/lib/workflows/port-resolution';

/**
 * Generic ports exist so one Pick one step serves every media kind. These tests
 * pin the behaviour that made a second video-only Pick node unnecessary.
 */

const animateToPickToDraft: ResolutionGraph = {
  nodes: [
    { id: 'idea', type: 'IDEA_GENERATOR', name: 'Ideas' },
    { id: 'images', type: 'IMAGE_GENERATOR', name: 'Images' },
    { id: 'animate', type: 'ANIMATE_IMAGE', name: 'Animate' },
    { id: 'pick', type: 'PICK', name: 'Pick one' },
    { id: 'draft', type: 'CREATE_DRAFT', name: 'Draft' },
  ],
  edges: [
    { sourceNodeId: 'idea', sourcePort: 'prompts', targetNodeId: 'images', targetPort: 'prompts' },
    { sourceNodeId: 'images', sourcePort: 'images', targetNodeId: 'animate', targetPort: 'images' },
    { sourceNodeId: 'animate', sourcePort: 'clips', targetNodeId: 'pick', targetPort: 'items' },
  ],
};

describe('generic port resolution', () => {
  it('narrows a Pick output to the kind of list feeding it', () => {
    const resolved = resolveOutputType(animateToPickToDraft, 'pick', 'item');
    expect(resolved).toEqual({
      state: 'type',
      type: { scalar: 'media', list: false, mediaKinds: [MediaType.VIDEO] },
    });
  });

  it('lets an animated clip list reach a draft through one Pick step', () => {
    expect(
      checkAddedEdge(animateToPickToDraft, {
        sourceNodeId: 'pick',
        sourcePort: 'item',
        targetNodeId: 'draft',
        targetPort: 'video',
      }),
    ).toBeNull();
  });

  it('still refuses a picked image at a video-only input', () => {
    const graph: ResolutionGraph = {
      ...animateToPickToDraft,
      edges: [
        animateToPickToDraft.edges[0],
        { sourceNodeId: 'images', sourcePort: 'images', targetNodeId: 'pick', targetPort: 'items' },
      ],
    };
    const problem = checkAddedEdge(graph, {
      sourceNodeId: 'pick',
      sourcePort: 'item',
      targetNodeId: 'draft',
      targetPort: 'video',
    });
    expect(problem?.reason).toContain('video');
  });

  it('asks for the upstream connection before typing the output', () => {
    const graph: ResolutionGraph = { ...animateToPickToDraft, edges: [] };
    expect(resolveOutputType(graph, 'pick', 'item')).toMatchObject({ state: 'awaiting' });

    const problem = checkAddedEdge(graph, {
      sourceNodeId: 'pick',
      sourcePort: 'item',
      targetNodeId: 'draft',
      targetPort: 'video',
    });
    expect(problem?.reason).toContain('Items');
  });

  it('refuses an upstream rewire that would break what Pick already feeds', () => {
    // Pick already feeds a video-only input, so pointing it at an image list
    // has to fail here rather than three steps later at run time.
    const graph: ResolutionGraph = {
      nodes: animateToPickToDraft.nodes,
      edges: [
        animateToPickToDraft.edges[0],
        animateToPickToDraft.edges[1],
        { sourceNodeId: 'pick', sourcePort: 'item', targetNodeId: 'draft', targetPort: 'video' },
      ],
    };
    const problem = checkAddedEdge(graph, {
      sourceNodeId: 'images',
      sourcePort: 'images',
      targetNodeId: 'pick',
      targetPort: 'items',
    });
    expect(problem?.reason).toContain('break a later connection');
  });

  it('accepts a fully wired graph and names the step in a failure', () => {
    const good: ResolutionGraph = {
      nodes: animateToPickToDraft.nodes,
      edges: [
        ...animateToPickToDraft.edges,
        { sourceNodeId: 'pick', sourcePort: 'item', targetNodeId: 'draft', targetPort: 'video' },
      ],
    };
    expect(checkGraphTypes(good)).toBeNull();

    const bad: ResolutionGraph = {
      nodes: animateToPickToDraft.nodes,
      edges: [
        { sourceNodeId: 'idea', sourcePort: 'prompts', targetNodeId: 'draft', targetPort: 'video' },
      ],
    };
    expect(checkGraphTypes(bad)?.reason).toContain('Draft');
  });

  it('reports a port that no longer exists instead of throwing', () => {
    expect(
      checkEdge(animateToPickToDraft, {
        sourceNodeId: 'pick',
        sourcePort: 'gone',
        targetNodeId: 'draft',
        targetPort: 'video',
      })?.reason,
    ).toContain('no longer exists');
  });

  it('does not hang on a cycle through a generic step', () => {
    const looped: ResolutionGraph = {
      nodes: [{ id: 'pick', type: 'PICK', name: 'Pick one' }],
      edges: [
        { sourceNodeId: 'pick', sourcePort: 'item', targetNodeId: 'pick', targetPort: 'items' },
      ],
    };
    expect(resolveOutputType(looped, 'pick', 'item')).toMatchObject({ state: 'awaiting' });
  });
});

/**
 * A port can be retired by a release — titles stopped being wired when they
 * started travelling with the media — and the edges saved against it outlive
 * the deploy that removed it. Production hit this: every workflow holding one
 * refused to run, naming a connection the canvas could no longer draw.
 */
describe('a graph holding an edge to a retired port', () => {
  const graph = {
    nodes: [
      { id: 'idea', type: 'IDEA_GENERATOR', config: {} },
      { id: 'images', type: 'IMAGE_GENERATOR', config: {} },
    ],
    edges: [
      { sourceNodeId: 'idea', sourcePort: 'prompts', targetNodeId: 'images', targetPort: 'prompts' },
      { sourceNodeId: 'idea', sourcePort: 'titles', targetNodeId: 'images', targetPort: 'titles' },
    ],
  };

  it('validates, so the workflow still runs', () => {
    expect(checkGraphTypes(graph)).toBeNull();
  });

  it('still refuses a new edge onto a port that does not exist', () => {
    expect(checkAddedEdge(graph, {
      sourceNodeId: 'idea', sourcePort: 'titles', targetNodeId: 'images', targetPort: 'titles',
    })).toEqual({ reason: 'That connection point no longer exists.' });
  });
});
