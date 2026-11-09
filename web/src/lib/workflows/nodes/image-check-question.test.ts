import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { checkQuestionOf, DEFAULT_CHECK_QUESTION } from '@/lib/workflows/nodes/image-generator';

describe('which question the picture check asks', () => {
  it('asks the step\'s own question while testing is on', () => {
    expect(checkQuestionOf({ testPicture: true, checkQuestion: '  Is there any text in the picture?  ' })).toBe('Is there any text in the picture?');
    expect(checkQuestionOf({ testPicture: false, checkQuestion: 'Ignored while off' })).toBeNull();
  });

  it('keeps steps saved with the old switch checking', () => {
    expect(checkQuestionOf({ checkCharacters: true })).toBe(DEFAULT_CHECK_QUESTION);
  });
});

describe('saving a step that tests its pictures', () => {
  it('needs a question while testing is on', async () => {
    const { parseConfig } = await import('@/lib/workflows/definitions');
    expect(() => parseConfig('IMAGE_GENERATOR', { testPicture: true, checkQuestion: ' ' })).toThrow();
    expect(() => parseConfig('IMAGE_GENERATOR', { testPicture: true, checkQuestion: 'Real cartoons?' })).not.toThrow();
  });
});

describe('a refused picture', () => {
  it('is recognised from the image tool\'s message', async () => {
    const { isRefusal } = await import('@/lib/workflows/nodes/image-generator');
    expect(isRefusal(new Error('image-use exited with 1: … | no image returned; the model replied instead: "I can\'t."'))).toBe(true);
    expect(isRefusal(new Error('image-use exited with 1: timed out'))).toBe(false);
  });
});
