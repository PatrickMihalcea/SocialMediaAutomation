import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { composePrompt, resolveStepProvider, type Config } from '@/lib/workflows/nodes/image-generator';

const config = (overrides: Partial<Config>): Config => ({
  size: '1024x1536',
  style: '',
  referenceUse: 'layout',
  styleImage: null,
  maxImages: 8,
  provider: 'image-use',
  useMockGeneration: false,
  ...overrides,
});

describe('image step provider', () => {
  it('uses the subscription by default, whatever the deployment is set to', () => {
    expect(resolveStepProvider(config({}))).toBe('image-use');
  });

  it('pins the step to the chosen source', () => {
    expect(resolveStepProvider(config({ provider: 'image-use' }))).toBe('image-use');
    expect(resolveStepProvider(config({ provider: 'openai' }))).toBe('openai');
    expect(resolveStepProvider(config({ provider: 'mock' }))).toBe('mock');
  });

  /**
   * The migration that matters. A step built to avoid spending quota predates
   * this setting, and reading it as "no preference" would start billing it.
   */
  it('keeps mocking a step saved before the setting existed', () => {
    expect(resolveStepProvider(config({ useMockGeneration: true }))).toBe('mock');
  });

  /**
   * The panel clears useMockGeneration whenever someone picks a source, so a
   * step carrying both is one nobody has opened since the setting existed —
   * and its author's intent was "do not spend anything".
   */
  it('keeps the old flag winning until someone actually picks a source', () => {
    expect(resolveStepProvider(config({ provider: 'openai', useMockGeneration: true }))).toBe('mock');
  });
});

describe('composePrompt', () => {
  const prompt = 'A cliffside villa at dusk, warm light spilling from tall windows.';

  it('leaves the prompt alone when no style is set', () => {
    expect(composePrompt({ prompt, style: '', hasReference: false })).toBe(prompt);
    expect(composePrompt({ prompt, style: '   ', hasReference: false })).toBe(prompt);
  });

  /**
   * The guarantee this field exists for. The prompts in a run vary by design,
   * so a style the prompt writer was merely told about gets re-interpreted in
   * each one — and a video that is half pixel art and half photograph is not a
   * loosely applied style, it is broken.
   */
  it('appends the same style text to every prompt in a set', () => {
    const prompts = ['A villa at dusk.', 'A cabin in fog.', 'A library at night.'];
    const style = 'Pixel art, 16-colour palette, hard 1px outlines.';

    const tails = prompts.map((entry) => composePrompt({ prompt: entry, style, hasReference: false }).slice(entry.length));

    expect(new Set(tails).size).toBe(1);
    expect(tails[0]).toContain(style);
  });

  it('says the style overrides a conflicting description', () => {
    const styled = composePrompt({ prompt, style: 'Pixel art.', hasReference: false });

    expect(styled).toMatch(/follow the style instead/);
    expect(styled).toMatch(/identically to every other image in this set/);
  });

  it('puts the style last, where it carries the most weight', () => {
    expect(composePrompt({ prompt, style: 'Anime, cel shaded.', hasReference: false }).trimEnd().endsWith('Anime, cel shaded.')).toBe(true);
  });

  it('keeps the prompt itself intact', () => {
    expect(composePrompt({ prompt, style: 'Pixel art.', hasReference: false })).toContain(prompt);
  });
});

describe('composePrompt with a layout reference', () => {
  const prompt = 'A cliffside villa at dusk, warm light spilling from tall windows.';
  const withRef = (style = '') => composePrompt({ prompt, style, hasReference: true });

  it('says nothing about a reference when none is attached', () => {
    expect(composePrompt({ prompt, style: '', hasReference: false })).toBe(prompt);
  });

  /**
   * A sketch with "kitchen" written across a box otherwise invites the model to
   * letter that word into the render, and a pencil drawing invites a pencil
   * drawing back. The reference is an arrangement, not artwork.
   */
  it('rules out copying the sketch\'s lettering or its drawing style', () => {
    const composed = withRef();

    expect(composed).toMatch(/Do not reproduce any words, labels, lettering/);
    expect(composed).toMatch(/do not imitate how it is drawn/);
  });

  it('asks for the arrangement, and allows deviation from it', () => {
    const composed = withRef();

    expect(composed).toMatch(/only for the arrangement of the scene/);
    expect(composed).toMatch(/Treat the layout as approximate/);
    expect(composed).toMatch(/deviate where it makes a better image/);
  });

  it('keeps the style last, above the layout note', () => {
    const composed = withRef('Pixel art.');

    expect(composed.indexOf('layout reference image')).toBeLessThan(composed.indexOf('STYLE'));
    expect(composed.trimEnd().endsWith('Pixel art.')).toBe(true);
  });

  it('is the same note on every image in the set', () => {
    const notes = ['A villa.', 'A cabin.', 'A library.'].map((entry) =>
      composePrompt({ prompt: entry, style: '', hasReference: true }).slice(entry.length));

    expect(new Set(notes).size).toBe(1);
  });
});

/**
 * Two references, two opposite instructions.
 *
 * A layout sketch is followed for arrangement and ignored for everything else.
 * A cast of characters is the other way round: how it looks is the whole point,
 * and copying its composition would make every scene the same picture. One note
 * cannot serve both, and sending the layout wording with a cast sheet actively
 * tells the model to throw away the thing it was given.
 */
describe('what the reference is for', () => {
  const withReference = (referenceUse: 'layout' | 'subject') =>
    composePrompt({ prompt: 'a wizard reads by candlelight', style: '', hasReference: true, referenceUse });

  it('tells the model to follow a layout only for arrangement', () => {
    const prompt = withReference('layout');

    expect(prompt).toContain('Follow it only for the arrangement of the scene');
    expect(prompt).toContain('do not imitate how it is drawn');
  });

  it('tells it to keep the subjects, and to change the composition', () => {
    const prompt = withReference('subject');

    expect(prompt).toContain('Keep the same characters or objects it shows');
    expect(prompt).toContain('recognisably the same cast');
    expect(prompt).toContain('Do not copy the composition');
  });

  /** The two must not blur into each other — that was the whole problem. */
  it('never sends the layout wording when the reference is the subjects', () => {
    expect(withReference('subject')).not.toContain('Follow it only for the arrangement');
    expect(withReference('layout')).not.toContain('Keep the same characters');
  });

  it('says nothing about a reference when none is attached', () => {
    const prompt = composePrompt({ prompt: 'a wizard', style: '', hasReference: false, referenceUse: 'subject' });

    expect(prompt).not.toContain('reference image');
    expect(prompt).toBe('a wizard');
  });

  /** Steps built before this setting existed carry a theme sketch. */
  it('treats an unset mode as a layout, which is what older steps meant', () => {
    const prompt = composePrompt({ prompt: 'a wizard', style: '', hasReference: true });

    expect(prompt).toContain('Follow it only for the arrangement of the scene');
  });
});
