import { describe, expect, it } from 'vitest';
import { NODE_DEFINITIONS, NODE_TYPES, getDefinition, parseConfig } from '@/lib/workflows/definitions';
import { checkCompatible } from '@/lib/workflows/ports';

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
    if (type === 'PUBLISH') return; // requires at least one channel, by design
    expect(() => parseConfig(definition.type, {})).not.toThrow();
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

  it('lets the bedroom pipeline connect end to end', () => {
    // The path the seeded workflow takes. If a port shape changes and breaks it,
    // this is the test that says so.
    const path: [string, string, string, string][] = [
      ['IDEA_GENERATOR', 'prompts', 'IMAGE_GENERATOR', 'prompts'],
      ['IMAGE_GENERATOR', 'images', 'BEAT_SLIDESHOW', 'images'],
      ['MUSIC_SELECTOR', 'audio', 'BEAT_SLIDESHOW', 'audio'],
      ['BEAT_SLIDESHOW', 'video', 'TEXT_OVERLAY', 'video'],
      ['BEAT_SLIDESHOW', 'segments', 'TEXT_OVERLAY', 'segments'],
      ['TEXT_OVERLAY', 'video', 'CREATE_DRAFT', 'video'],
      ['TEXT_OVERLAY', 'video', 'PUBLISH', 'video'],
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

  it('has a Pick node for every list-to-single conversion the catalogue needs', () => {
    // Strict typing makes media[] -> media a dead end without one.
    const pick = getDefinition('PICK')!;
    expect(pick.inputs[0].type.list).toBe(true);
    expect(pick.outputs[0].type.list).toBe(false);
    expect(
      checkCompatible(getDefinition('IMAGE_GENERATOR')!.outputs[0].type, pick.inputs[0].type),
    ).toBeNull();
  });
});
