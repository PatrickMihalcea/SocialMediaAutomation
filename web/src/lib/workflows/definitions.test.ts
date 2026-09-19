import { describe, expect, it } from 'vitest';
import {
  NODE_DEFINITIONS,
  NODE_TYPES,
  PUBLISH_CHANNEL_REQUIRED,
  getDefinition,
  getNodePorts,
  isCreatableNodeType,
  nodeRunConfigIssue,
  nodeSaveConfigIssue,
  nodeUsesChannelPicker,
  parseConfig,
} from '@/lib/workflows/definitions';
import { checkCompatible } from '@/lib/workflows/ports';
import { IMAGE_SIZE_VALUES } from '@/lib/ai/image-sizes';

/**
 * A contract test over the whole node catalogue, in the spirit of
 * adapter-contract.test.ts: every node must satisfy these regardless of what it
 * does, so a new node type cannot be added half-finished.
 */
describe('node catalogue', () => {
  it.each(NODE_TYPES)('%s has unique, non-empty ports', (type) => {
    const definition = getDefinition(type)!;
    const inputIds = definition.inputs.map((p) => p.id);
    const outputIds = definition.outputs.map((p) => p.id);

    expect(new Set(inputIds).size).toBe(inputIds.length);
    expect(new Set(outputIds).size).toBe(outputIds.length);
    for (const port of [...definition.inputs, ...definition.outputs]) {
      expect(port.label.length).toBeGreaterThan(0);
    }
  });

  it.each(NODE_TYPES)('%s parses an empty config into valid defaults', (type) => {
    // A newly dropped node must be immediately valid, not half-configured.
    const definition = getDefinition(type)!;
    expect(() => parseConfig(definition.type, {})).not.toThrow();
  });

  it('defaults publish channels to an empty list until the editor chooses some', () => {
    expect(parseConfig('PUBLISH', {})).toMatchObject({
      socialAccountIds: [],
      mode: 'queue',
      requireApproval: true,
    });
  });

  it('requires publish channels before save or run', () => {
    expect(nodeSaveConfigIssue('PUBLISH', {})).toEqual({
      message: PUBLISH_CHANNEL_REQUIRED,
      fields: { socialAccountIds: [PUBLISH_CHANNEL_REQUIRED] },
    });
    expect(nodeRunConfigIssue('PUBLISH', 'Publish clip', {})).toBe(
      '"Publish clip" needs at least one channel selected.',
    );
  });

  it('accepts publish config once a channel is chosen', () => {
    const config = {
      socialAccountIds: ['11111111-1111-4111-8111-111111111111'],
      caption: 'Hello',
    };
    expect(nodeSaveConfigIssue('PUBLISH', config)).toBeNull();
    expect(nodeRunConfigIssue('PUBLISH', 'Publish clip', config)).toBeNull();
  });

  it('exposes channel pickers only on publish steps', () => {
    expect(nodeUsesChannelPicker('PUBLISH')).toBe(true);
    expect(nodeUsesChannelPicker('CREATE_DRAFT')).toBe(true);
    expect(nodeUsesChannelPicker('BEAT_SLIDESHOW')).toBe(false);
  });

  it.each(NODE_TYPES)('%s declares a label and a description', (type) => {
    const definition = getDefinition(type)!;
    expect(definition.label.length).toBeGreaterThan(2);
    expect(definition.description.length).toBeGreaterThan(10);
  });

  it('keeps the type key and the type field in step', () => {
    for (const [key, definition] of Object.entries(NODE_DEFINITIONS)) {
      expect(definition.type).toBe(key);
    }
  });

  it('keeps Music executable only for legacy saved workflows', () => {
    expect(getDefinition('MUSIC_SELECTOR')).toMatchObject({ legacy: true });
    expect(getDefinition('MEDIA_LIBRARY')?.legacy).not.toBe(true);
    expect(isCreatableNodeType('MUSIC_SELECTOR')).toBe(false);
    expect(isCreatableNodeType('MEDIA_LIBRARY')).toBe(true);
  });

  // The extra outputs are user-named, so nothing stops someone typing a name
  // that a built-in output already uses. A duplicate port id would give the
  // step two ports answering to one name, and an edge no way to say which.
  it('does not let an extra Idea generator output shadow a built-in one', () => {
    const ports = getNodePorts(
      'IDEA_GENERATOR',
      { additionalOutputs: [{ id: 'caption', label: 'Caption' }, { id: 'cta', label: 'Call to action' }] },
      'outputs',
    );
    const ids = ports.map((port) => port.id);

    expect(ids.filter((id) => id === 'caption')).toHaveLength(1);
    expect(ids).toContain('cta');
    expect(ports.find((port) => port.id === 'caption')!.label).toBe('Caption');
  });

  it('keeps legacy and mixed-media pipeline contracts compatible', () => {
    const path: [string, string, string, string][] = [
      ['IDEA_GENERATOR', 'prompts', 'IMAGE_GENERATOR', 'prompts'],
      ['IDEA_GENERATOR', 'postTitle', 'PUBLISH', 'title'],
      ['IMAGE_GENERATOR', 'images', 'COMBINE_MEDIA', 'media1'],
      ['MEDIA_LIBRARY', 'videos', 'COMBINE_MEDIA', 'media2'],
      ['COMBINE_MEDIA', 'media', 'BEAT_SLIDESHOW', 'images'],
      ['MUSIC_SELECTOR', 'audio', 'BEAT_SLIDESHOW', 'audio'],
      ['BEAT_SLIDESHOW', 'video', 'TEXT_OVERLAY', 'video'],
      ['TEXT_OVERLAY', 'video', 'CREATE_DRAFT', 'video'],
      ['TEXT_OVERLAY', 'video', 'PUBLISH', 'video'],
      // The written parts of a post can come from the brief rather than being
      // typed into the publish step.
      ['IDEA_GENERATOR', 'caption', 'CREATE_DRAFT', 'caption'],
      ['IDEA_GENERATOR', 'caption', 'PUBLISH', 'caption'],
      ['IDEA_GENERATOR', 'hashtags', 'CREATE_DRAFT', 'hashtags'],
      ['IDEA_GENERATOR', 'hashtags', 'PUBLISH', 'hashtags'],
      ['IDEA_GENERATOR', 'postTitle', 'CREATE_DRAFT', 'title'],
      // The opening line can be generated too, not just typed.
      ['IDEA_GENERATOR', 'postTitle', 'TEXT_OVERLAY', 'firstTemplate'],
    ];

    for (const [fromType, fromPort, toType, toPort] of path) {
      const out = getDefinition(fromType)!.outputs.find((p) => p.id === fromPort);
      const input = getDefinition(toType)!.inputs.find((p) => p.id === toPort);
      expect(out, `${fromType}.${fromPort} should exist`).toBeDefined();
      expect(input, `${toType}.${toPort} should exist`).toBeDefined();
      expect(
        checkCompatible(out!.type, input!.type),
        `${fromType}.${fromPort} -> ${toType}.${toPort}`,
      ).toBeNull();
    }
  });

  it('defaults beat slideshow output to vertical presets', () => {
    const config = parseConfig('BEAT_SLIDESHOW', {});
    expect(config).toEqual(expect.objectContaining({ size: '1080x1920' }));
    expect(config).not.toHaveProperty('width');
    expect(config).not.toHaveProperty('height');
  });

  it('normalises legacy beat slideshow width and height into presets', () => {
    const landscape = parseConfig('BEAT_SLIDESHOW', { width: 1920, height: 1080 });
    expect(landscape).toEqual(expect.objectContaining({ size: '1920x1080' }));
    expect(landscape).not.toHaveProperty('width');
    expect(landscape).not.toHaveProperty('height');

    const vertical = parseConfig('BEAT_SLIDESHOW', { width: 1080, height: 1920, fps: 24 });
    expect(vertical).toEqual(expect.objectContaining({ size: '1080x1920', fps: 24 }));
    expect(vertical).not.toHaveProperty('width');
    expect(vertical).not.toHaveProperty('height');
  });

  it('keeps non-preset legacy beat slideshow dimensions explicit', () => {
    const config = parseConfig('BEAT_SLIDESHOW', { width: 1280, height: 720 });
    expect(config).toEqual(expect.objectContaining({ width: 1280, height: 720 }));
    expect(config).not.toHaveProperty('size');
  });

  it('rejects incomplete or non-numeric leftover beat slideshow dimensions', () => {
    expect(() => parseConfig('BEAT_SLIDESHOW', { width: '1920', height: 1080 })).toThrow();
    expect(() => parseConfig('BEAT_SLIDESHOW', { width: 1920 })).toThrow();
  });

  it('names overlay structure instead of a freeform per-cut template', () => {
    expect(parseConfig('TEXT_OVERLAY', {})).toMatchObject({ structure: 'numbered', template: '{index}' });
    expect(parseConfig('TEXT_OVERLAY', {
      template: '{index}',
      firstTemplate: 'Which treehouse would you choose?',
    })).toMatchObject({ structure: 'opening-numbered' });
    // No port for the repeating label: the structure picker decides it, and a
    // port that silently outranked the dropdown was a second way to set one
    // thing. The field stays in the schema so older steps still parse.
    expect(getDefinition('TEXT_OVERLAY')?.inputs.find((port) => port.id === 'template'))
      .toBeUndefined();
  });

  it('does not apply video export presets to image generation size', () => {
    expect(parseConfig('IMAGE_GENERATOR', {})).toEqual(
      expect.objectContaining({ size: '1024x1536', useMockGeneration: false }),
    );
    expect(() => parseConfig('IMAGE_GENERATOR', { size: '1080x1920' })).toThrow();
  });

  it('allows expensive media generators to be mocked per step', () => {
    expect(parseConfig('IMAGE_GENERATOR', { useMockGeneration: true }))
      .toEqual(expect.objectContaining({ useMockGeneration: true }));
    expect(parseConfig('ANIMATE_IMAGE', { useMockGeneration: true }))
      .toEqual(expect.objectContaining({ useMockGeneration: true }));
  });

  it('accepts every image size the provider supports', () => {
    for (const size of IMAGE_SIZE_VALUES) {
      expect(parseConfig('IMAGE_GENERATOR', { size })).toEqual(expect.objectContaining({ size }));
    }
  });

  it('has one selector for list-to-list and list-to-single workflows', () => {
    // Strict typing makes media[] -> media a dead end without one.
    const pick = getDefinition('PICK')!;
    expect(pick.inputs[0].type.list).toBe(true);
    expect(pick.outputs[0].type.list).toBe(false);
    expect(pick.outputs.find((port) => port.id === 'selection')?.type.list).toBe(true);
    expect(
      checkCompatible(getDefinition('IMAGE_GENERATOR')!.outputs[0].type, pick.inputs[0].type),
    ).toBeNull();
  });

  it('offers exactly one selection step, typed from the list it is given', () => {
    // Two near-identical Pick nodes is the smell this asserts against: the one
    // node adapts instead, so a video list picks down to something a publish
    // step accepts without a video-only duplicate in the palette.
    const picks = NODE_TYPES.filter((type) => type.startsWith('PICK'));
    expect(picks).toEqual(['PICK']);
    expect(getDefinition('PICK')!.outputs[0].followsInput).toBe('items');
  });

  /**
   * The route a filename takes to become a label on a cut. Each hop is checked
   * with the same function the canvas calls before it will let go of a
   * connection, so a port rename that quietly breaks the chain fails here
   * rather than in a run someone has to watch to catch.
   */
  /**
   * Titles used to be wired: MEDIA_LIBRARY.imageTitles to PICK.labels to
   * BEAT_SLIDESHOW.titles, three connections nobody could see were missing
   * until the cuts came out unlabelled. They ride with the media now, so the
   * contract is that no step offers a port for them at all.
   */
  it('gives titles no port anywhere, because they travel with the media', () => {
    for (const type of ['IDEA_GENERATOR', 'IMAGE_GENERATOR', 'MEDIA_LIBRARY', 'PICK', 'COMBINE_MEDIA', 'BEAT_SLIDESHOW']) {
      const definition = getDefinition(type)!;
      const ports = [...definition.inputs, ...definition.outputs].map((port) => port.id);
      expect(ports.filter((id) => /^(titles|labels|imageTitles)/.test(id)), `${type}`).toEqual([]);
    }
  });

  // The labels port is a plain text list on both sides: it must not follow the
  // items input, or connecting a media list would retype it as media.
  it('selects items without a second list to keep in step with them', () => {
    const pick = getDefinition('PICK')!;

    expect(pick.inputs.map((port) => port.id)).toEqual(['items']);
    expect(pick.outputs.map((port) => port.id)).toEqual(['item', 'selection']);
  });

  it('loads library media and defaults selection compatibly with old Pick nodes', () => {
    const source = getDefinition('MEDIA_LIBRARY')!;
    expect(source.outputs.map((port) => port.id)).toEqual(['images', 'videos', 'audio']);
    // Every one is a list, so a Select items step is still required before any
    // single-item input.
    expect(source.outputs.every((port) => port.type.list)).toBe(true);
    expect(parseConfig('MEDIA_LIBRARY', {})).toEqual({
      folderId: null,
      assetId: null,
      includeSubfolders: true,
    });
    expect(parseConfig('PICK', { index: 0 })).toEqual({
      mode: 'index',
      count: 1,
      index: 0,
    });
  });

  it('opens new Trimmers in range mode and migrates old Audio trimmer settings', () => {
    expect(parseConfig('AUDIO_TRIMMER', {})).toEqual({
      mode: 'range',
      startSeconds: null,
      endSeconds: null,
      bars: 8,
      snapToDownbeat: true,
    });
    expect(parseConfig('AUDIO_TRIMMER', {
      startSeconds: null,
      bars: 16,
      snapToDownbeat: false,
    })).toEqual({
      mode: 'bars',
      startSeconds: null,
      endSeconds: null,
      bars: 16,
      snapToDownbeat: false,
    });
    expect(() => parseConfig('AUDIO_TRIMMER', {
      mode: 'range',
      startSeconds: 5,
      endSeconds: 4,
    })).toThrow(/end time/i);
    const trimmer = getDefinition('AUDIO_TRIMMER')!;
    expect(trimmer.inputs[0].type).toMatchObject({
      scalar: 'media',
      mediaKinds: ['AUDIO', 'VIDEO'],
    });
    expect(trimmer.outputs[0].followsInput).toBe('audio');
  });
});

describe('configs saved by earlier releases', () => {
  /**
   * Narrowing an enum orphans every row that used the value removed, and
   * parseConfig throws rather than failing politely — so a workflow that ran
   * yesterday stops opening, stops saving and stops running. IMAGE_GENERATOR
   * briefly offered 'default'.
   */
  it('keeps an image step readable after the deployment option was removed', () => {
    expect(() => parseConfig('IMAGE_GENERATOR', { provider: 'default' })).not.toThrow();
    expect(parseConfig('IMAGE_GENERATOR', { provider: 'default' })).toMatchObject({
      provider: 'image-use',
    });
    // A step that was also mocking keeps mocking, rather than silently
    // switching to something that spends quota.
    expect(parseConfig('IMAGE_GENERATOR', { provider: 'default', useMockGeneration: true })).toMatchObject({
      provider: 'mock',
    });
  });

  it('leaves a current config untouched', () => {
    expect(parseConfig('IMAGE_GENERATOR', { provider: 'openai' })).toMatchObject({ provider: 'openai' });
  });
});
