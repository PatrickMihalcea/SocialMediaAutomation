import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { checkQuestionOf, DEFAULT_CHECK_QUESTION } from '@/lib/workflows/nodes/image-generator';

describe('which question the picture check asks', () => {
  it('asks the step\'s own question', () => {
    expect(checkQuestionOf({ checkQuestion: '  Is there any text in the picture?  ' })).toBe('Is there any text in the picture?');
  });

  it('keeps steps saved with the old switch checking, and skips when neither is set', () => {
    expect(checkQuestionOf({ checkCharacters: true })).toBe(DEFAULT_CHECK_QUESTION);
    expect(checkQuestionOf({ checkQuestion: '' })).toBeNull();
  });
});
