import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveStepProvider, type Config } from '@/lib/workflows/nodes/image-generator';

const config = (overrides: Partial<Config>): Config => ({
  size: '1024x1536',
  maxImages: 8,
  provider: 'default',
  useMockGeneration: false,
  ...overrides,
});

describe('image step provider', () => {
  it('defers to the deployment when nothing is pinned', () => {
    expect(resolveStepProvider(config({}))).toBeUndefined();
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

  it('lets an explicit choice override the old flag', () => {
    expect(resolveStepProvider(config({ provider: 'image-use', useMockGeneration: true }))).toBe('image-use');
  });
});
