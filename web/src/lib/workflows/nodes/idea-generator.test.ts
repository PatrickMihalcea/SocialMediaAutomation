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
    expect(instruction).toContain('describing the whole set. Follow this direction: Two sentences, no emoji.');
    expect(instruction).toContain('without the # sign. Follow this direction: Three tags at most.');
  });

  // Blank guidance must leave the default wording clean rather than trailing an
  // empty instruction the model has to interpret.
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
      [],
      random(0),
    )).toBe('wired theme');
  });

  it('uses the typed theme when the step is not drawing at random', () => {
    expect(resolveTheme({ themeMode: 'fixed', theme: 'coastal rooms', themePool: pool }, null, []))
      .toBe('coastal rooms');
  });

  it('draws from the pool, skipping what this step used recently', () => {
    const chosen = resolveTheme(
      { themeMode: 'random', theme: '', themePool: pool },
      null,
      ['Interior design', 'Luxury homes'],
      random(0),
    );
    expect(chosen).toBe('Brutalist landmarks');
  });

  it('draws from the whole pool again once every theme has been used', () => {
    const chosen = resolveTheme(
      { themeMode: 'random', theme: '', themePool: pool },
      null,
      [...pool].reverse(),
      random(0.99),
    );
    expect(pool).toContain(chosen);
  });

  it('is empty when random mode has nothing to draw from, so the run says so', () => {
    expect(resolveTheme({ themeMode: 'random', theme: 'ignored', themePool: [] }, null, [])).toBe('');
  });

  it('ignores blank and duplicated pool entries', () => {
    expect(resolveTheme(
      { themeMode: 'random', theme: '', themePool: ['  Luxury homes  ', 'Luxury homes', '   '] },
      null,
      [],
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
