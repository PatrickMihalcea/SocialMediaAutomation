import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai', () => ({ generateObject: vi.fn() }));
vi.mock('@/lib/ai/brand-voice', () => ({ buildSystemPrompt: vi.fn() }));

import { buildIdeaInstruction } from '@/lib/workflows/nodes/idea-generator';
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
