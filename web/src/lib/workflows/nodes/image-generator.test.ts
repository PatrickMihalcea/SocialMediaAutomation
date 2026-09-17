import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveStepProvider, type Config } from '@/lib/workflows/nodes/image-generator';

const config = (overrides: Partial<Config>): Config => ({
  size: '1024x1536',
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
