import { describe, expect, it } from 'vitest';
import { resolveImageProviderName } from '@/lib/ai/provider-selection';

describe('resolveImageProviderName', () => {
  it('inherits the text provider by default', () => {
    expect(resolveImageProviderName('mock', 'inherit')).toBe('mock');
    expect(resolveImageProviderName('openai', 'inherit')).toBe('openai');
  });

  it('can mock images while leaving text on OpenAI', () => {
    expect(resolveImageProviderName('openai', 'mock')).toBe('mock');
  });

  it('can use real images independently as well', () => {
    expect(resolveImageProviderName('mock', 'openai')).toBe('openai');
  });
});
