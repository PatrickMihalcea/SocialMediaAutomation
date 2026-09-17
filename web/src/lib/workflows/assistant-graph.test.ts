import { describe, expect, it } from 'vitest';
import {
  normalizeAssistantAction,
  validateProposedGraph,
  weeklyReelTemplate,
  workflowAssistantSkill,
} from '@/lib/workflows/assistant-graph';
import { assistantReplySchema } from '@/lib/ai/schemas';

describe('assistant workflow graphs', () => {
  it('accepts the weekly reel template', () => {
    const graph = weeklyReelTemplate('coastal bedrooms');
    expect(() => validateProposedGraph(graph.nodes, graph.edges)).not.toThrow();
    expect(graph.nodes.map((node) => node.type)).toEqual([
      'IDEA_GENERATOR',
      'IMAGE_GENERATOR',
      'MEDIA_LIBRARY',
      'PICK',
      'BEAT_SLIDESHOW',
      'TEXT_OVERLAY',
      'CREATE_DRAFT',
    ]);
  });

  it('rejects a loop', () => {
    expect(() => validateProposedGraph(
      [
        { key: 'a', type: 'AUDIO_TRIMMER', config: {} },
        { key: 'b', type: 'AUDIO_TRIMMER', config: {} },
      ],
      [
        { sourceKey: 'a', sourcePort: 'audio', targetKey: 'b', targetPort: 'audio' },
        { sourceKey: 'b', sourcePort: 'audio', targetKey: 'a', targetPort: 'audio' },
      ],
    )).toThrow(/loop/i);
  });

  it('rejects two writers on one input', () => {
    const graph = weeklyReelTemplate('occupied');
    expect(() => validateProposedGraph(graph.nodes, [
      ...graph.edges,
      { sourceKey: 'images', sourcePort: 'images', targetKey: 'slideshow', targetPort: 'images' },
    ])).toThrow(/already has something connected/i);
  });

  it('rejects a graph with a disconnected required input', () => {
    expect(() => validateProposedGraph(
      [{ key: 'draft', type: 'CREATE_DRAFT', config: {} }],
      [],
    )).toThrow(/needs a connection to its video input/i);
  });

  it('rejects adding the legacy Music step to a new workflow', () => {
    expect(() => validateProposedGraph(
      [{ key: 'music', type: 'MUSIC_SELECTOR', config: {} }],
      [],
    )).toThrow(/not a step available for new workflows/i);
  });

  it('lists every catalogue node in the assistant skill', () => {
    const skill = workflowAssistantSkill();
    expect(skill).toContain('IDEA_GENERATOR');
    expect(skill).toContain('MEDIA_LIBRARY');
    expect(skill).toContain('mode=random and count=3');
    expect(skill).toContain('fixed intro followed by generated options');
    expect(skill).toContain('PUBLISH');
    expect(skill).toContain('create_workflow');
    expect(skill).not.toContain('- MUSIC_SELECTOR');
  });

  it('accepts a fixed intro ordered before library options', () => {
    expect(() => validateProposedGraph(
      [
        {
          key: 'intro',
          type: 'MEDIA_LIBRARY',
          config: {
            assetId: '11111111-1111-4111-8111-111111111111',
            folderId: null,
            includeSubfolders: true,
          },
        },
        { key: 'options', type: 'MEDIA_LIBRARY', config: {} },
        { key: 'combine', type: 'COMBINE_MEDIA', config: {} },
        { key: 'track', type: 'PICK', config: { mode: 'first', count: 1, index: 0 } },
        { key: 'slideshow', type: 'BEAT_SLIDESHOW', config: {} },
      ],
      [
        { sourceKey: 'intro', sourcePort: 'videos', targetKey: 'combine', targetPort: 'media1' },
        { sourceKey: 'options', sourcePort: 'images', targetKey: 'combine', targetPort: 'media2' },
        { sourceKey: 'combine', sourcePort: 'media', targetKey: 'slideshow', targetPort: 'images' },
        { sourceKey: 'options', sourcePort: 'audio', targetKey: 'track', targetPort: 'items' },
        { sourceKey: 'track', sourcePort: 'item', targetKey: 'slideshow', targetPort: 'audio' },
      ],
    )).not.toThrow();
  });

  it('accepts a video workflow using three random existing folder images', () => {
    expect(() => validateProposedGraph(
      [
        {
          key: 'library',
          type: 'MEDIA_LIBRARY',
          config: {
            folderId: '11111111-1111-4111-8111-111111111111',
            includeSubfolders: true,
          },
        },
        { key: 'select', type: 'PICK', config: { mode: 'random', count: 3, index: 0 } },
        { key: 'track', type: 'PICK', config: { mode: 'random', count: 1, index: 0 } },
        { key: 'slideshow', type: 'BEAT_SLIDESHOW', config: {} },
        { key: 'draft', type: 'CREATE_DRAFT', config: {} },
      ],
      [
        { sourceKey: 'library', sourcePort: 'images', targetKey: 'select', targetPort: 'items' },
        { sourceKey: 'select', sourcePort: 'selection', targetKey: 'slideshow', targetPort: 'images' },
        { sourceKey: 'library', sourcePort: 'audio', targetKey: 'track', targetPort: 'items' },
        { sourceKey: 'track', sourcePort: 'item', targetKey: 'slideshow', targetPort: 'audio' },
        { sourceKey: 'slideshow', sourcePort: 'video', targetKey: 'draft', targetPort: 'video' },
      ],
    )).not.toThrow();
  });
});

describe('a theme drawn at random', () => {
  it('builds a reel whose idea step draws from the pool', () => {
    const graph = weeklyReelTemplate('architecture', ['Interior design', 'Luxury homes']);
    expect(() => validateProposedGraph(graph.nodes, graph.edges)).not.toThrow();
    expect(graph.nodes[0].config).toMatchObject({
      themeMode: 'random',
      theme: '',
      themePool: ['Interior design', 'Luxury homes'],
    });
  });

  it('is described in the skill the assistant is given', () => {
    const skill = workflowAssistantSkill();
    expect(skill).toContain('themeMode');
    expect(skill).toContain('themePool');
    // The mistake this replaces: routing text through the media-only Pick step.
    expect(skill).toContain('never wire a text output into PICK.items');
  });
});

describe('normalizeAssistantAction', () => {
  const parse = (action: unknown) => assistantReplySchema.parse({ reply: 'Here it is.', action });

  it('repairs the spellings a model reaches for in a new workflow', () => {
    const parsed = parse({
      kind: 'createWorkflow',
      summary: 'Create a reel',
      name: 'Architecture reel',
      nodes: [
        { key: 'Idea Step', type: 'idea_generator', settings: { theme: 'architecture' } },
        { key: 'images', type: 'IMAGE_GENERATOR', config: {} },
      ],
      edges: [{ source: 'Idea Step', sourcePort: 'prompts', target: 'images', targetPort: 'prompts' }],
    });

    expect(parsed.action).toMatchObject({
      kind: 'create_workflow',
      nodes: [
        { key: 'idea_step', type: 'IDEA_GENERATOR', config: { theme: 'architecture' } },
        { key: 'images', type: 'IMAGE_GENERATOR' },
      ],
      edges: [{ sourceKey: 'idea_step', sourcePort: 'prompts', targetKey: 'images', targetPort: 'prompts' }],
    });
  });

  it('repairs graph edit operation names and leaves step ids alone', () => {
    const nodeId = '55555555-5555-4555-8555-555555555555';
    const parsed = parse({
      kind: 'update_workflow',
      summary: 'Add a publish step',
      workflowId: nodeId,
      workflowName: 'Treehouses',
      graphEdits: [
        { operation: 'addNode', key: 'Publish Step', type: 'publish', config: { socialAccountIds: [] } },
        { operation: 'add_edge', source: nodeId, sourcePort: 'video', target: 'Publish Step', targetPort: 'video' },
      ],
    });

    expect(parsed.action).toMatchObject({
      graphEdits: [
        { operation: 'add_node', key: 'publish_step', type: 'PUBLISH' },
        // The uuid survives: lowercasing its hyphens would point the edit at nothing.
        { operation: 'connect', sourceNodeRef: nodeId, targetNodeRef: 'publish_step' },
      ],
    });
  });

  it('leaves anything it does not recognise for the schema to reject', () => {
    expect(normalizeAssistantAction(null)).toBeNull();
    expect(normalizeAssistantAction('nonsense')).toBe('nonsense');
    expect(assistantReplySchema.safeParse({ reply: 'x', action: { kind: 'invent_something' } }).success)
      .toBe(false);
  });
});
