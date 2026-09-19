import { describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({ workflowNodeRun: { findMany: vi.fn() } }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/ai', () => ({ generateObject: vi.fn() }));
vi.mock('@/lib/ai/brand-voice', () => ({ buildSystemPrompt: vi.fn() }));

import { buildIdeaInstruction, resolveTheme } from '@/lib/workflows/nodes/idea-generator';
import { parseConfig } from '@/lib/workflows/definitions';

const config = (overrides: Record<string, unknown> = {}) =>
  parseConfig('IDEA_GENERATOR', { theme: 'coastal rooms', count: 6, ...overrides }) as Parameters<
    typeof buildIdeaInstruction
  >[0];

describe('buildIdeaInstruction', () => {
  it('always asks for the title, caption and tags, however the step is configured', () => {
    const instruction = buildIdeaInstruction(config());

    expect(instruction).toContain('postTitle is a concise');
    expect(instruction).toContain('caption is the post copy itself');
    expect(instruction).toContain('hashtags are 3 to 8 relevant tags');
    expect(instruction).toContain('Produce exactly 6 entries.');
  });

  it('appends the direction given for each field', () => {
    const instruction = buildIdeaInstruction(config({
      titleGuidance: 'Phrase it as a question.',
      captionGuidance: 'Two sentences, no emoji.',
      hashtagsGuidance: 'Three tags at most.',
    }));

    expect(instruction).toContain('not just one image. Follow this direction: Phrase it as a question.');
    expect(instruction).toContain('written for a social feed. Follow this direction: Two sentences, no emoji.');
    expect(instruction).toContain('without the # sign. Follow this direction: Three tags at most.');
  });

  // Blank guidance must leave the default wording clean rather than trailing an
  // empty instruction the model has to interpret.
  /**
   * The prompts are what this step exists to write, and they were the one
   * output with no way to steer them — the other three guidance fields only
   * ever touched the post copy.
   */
  it('steers the prompts themselves, not only the post copy', () => {
    const instruction = buildIdeaInstruction(config({
      promptGuidance: 'Every prompt names where the light comes from.',
    }));

    expect(instruction).toContain(
      'prompt is the full description. Follow this direction: Every prompt names where the light comes from.',
    );
  });

  it('says nothing about direction when none was given', () => {
    const instruction = buildIdeaInstruction(config({ captionGuidance: '   ' }));

    expect(instruction).not.toContain('Follow this direction');
  });

  it('only mentions extra outputs when the step defines some', () => {
    expect(buildIdeaInstruction(config())).not.toContain('Also create these named text fields');

    const instruction = buildIdeaInstruction(config({
      additionalOutputs: [{ id: 'hook', label: 'Opening hook' }],
    }));
    expect(instruction).toContain('hook (Opening hook)');
  });
});

describe('resolveTheme', () => {
  const pool = ['Interior design', 'Luxury homes', 'Brutalist landmarks', 'Cliffside houses'];
  const random = (value: number) => () => value;

  it('prefers a connected theme over both settings', () => {
    expect(resolveTheme(
      { themeMode: 'random', theme: 'typed', themePool: pool },
      '  wired theme  ',
      random(0),
    )).toBe('wired theme');
  });

  it('uses the typed theme when the step is not drawing at random', () => {
    expect(resolveTheme({ themeMode: 'fixed', theme: 'coastal rooms', themePool: pool }, null))
      .toBe('coastal rooms');
  });

  it('draws from the whole pool, indexed by the roll', () => {
    expect(resolveTheme({ themeMode: 'random', theme: '', themePool: pool }, null, random(0)))
      .toBe('Interior design');
    expect(resolveTheme({ themeMode: 'random', theme: '', themePool: pool }, null, random(0.5)))
      .toBe('Brutalist landmarks');
    expect(resolveTheme({ themeMode: 'random', theme: '', themePool: pool }, null, random(0.999)))
      .toBe('Cliffside houses');
  });

  /**
   * The behaviour this replaced excluded recently-used themes, which meant a
   * pool of four only ever drew from three and the last theme could not come up
   * again. A draw that cannot repeat is a shuffle, not a draw.
   */
  it('can draw the same theme twice running', () => {
    const settings = { themeMode: 'random' as const, theme: '', themePool: pool };
    expect(resolveTheme(settings, null, random(0))).toBe('Interior design');
    expect(resolveTheme(settings, null, random(0))).toBe('Interior design');
  });

  it('reaches every entry in the pool across many draws', () => {
    const settings = { themeMode: 'random' as const, theme: '', themePool: pool };
    const seen = new Set(
      Array.from({ length: 400 }, () => resolveTheme(settings, null)),
    );
    expect(seen).toEqual(new Set(pool));
  });

  it('never indexes past the end when the roll is one', () => {
    expect(pool).toContain(
      resolveTheme({ themeMode: 'random', theme: '', themePool: pool }, null, random(1)),
    );
  });

  /**
   * A real pool is pasted, not typed. The cap was 60, set when the field took
   * one theme per line, and a pasted content calendar of a couple of hundred
   * subjects was silently rejected by config validation.
   */
  it('accepts a pool of a few hundred themes and draws across all of it', () => {
    const big = Array.from({ length: 179 }, (_, i) => `theme ${i + 1}`);
    const parsed = parseConfig('IDEA_GENERATOR', {
      themeMode: 'random',
      theme: '',
      themePool: big,
      count: 6,
    }) as { themePool: string[] };

    expect(parsed.themePool).toHaveLength(179);

    const settings = { themeMode: 'random' as const, theme: '', themePool: big };
    expect(resolveTheme(settings, null, () => 0)).toBe('theme 1');
    expect(resolveTheme(settings, null, () => 0.999)).toBe('theme 179');
    // Every entry is reachable, not just the head of the list.
    const seen = new Set(Array.from({ length: 4_000 }, () => resolveTheme(settings, null)));
    expect(seen.size).toBeGreaterThan(150);
  });

  it('is empty when random mode has nothing to draw from, so the run says so', () => {
    expect(resolveTheme({ themeMode: 'random', theme: 'ignored', themePool: [] }, null)).toBe('');
  });

  it('ignores blank and duplicated pool entries', () => {
    expect(resolveTheme(
      { themeMode: 'random', theme: '', themePool: ['  Luxury homes  ', 'Luxury homes', '   '] },
      null,
      random(0.9),
    )).toBe('Luxury homes');
  });
});

describe('buildIdeaInstruction recent work', () => {
  it('names what the step already covered so the next run does not repeat it', () => {
    const instruction = buildIdeaInstruction(config(), ['Oak kitchen', 'Sunken lounge']);
    expect(instruction).toContain('Oak kitchen; Sunken lounge');
  });

  it('says nothing about earlier runs on the first one', () => {
    expect(buildIdeaInstruction(config())).not.toContain('already covered');
  });
});
