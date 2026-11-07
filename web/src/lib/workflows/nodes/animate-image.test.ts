import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { animationProvider, withMotion } from '@/lib/workflows/nodes/animate-image';

/**
 * LTX takes its motion from the words: holding the first frame harder or
 * looser made no visible difference between the extremes. So the setting is
 * said in the prompt.
 */
describe('amount of motion', () => {
  const camera = 'Slow cinematic push in, subject stays centred.';

  it('leaves the camera movement as written for natural motion', () => {
    expect(withMotion(camera, 'natural')).toBe(camera);
  });

  it('asks for less, or more, after the camera movement', () => {
    expect(withMotion(camera, 'subtle')).toMatch(/^Slow cinematic push in.*almost still/);
    expect(withMotion(camera, 'lively')).toMatch(/^Slow cinematic push in.*lively and pronounced/);
  });
});

describe('which provider animates', () => {
  it('lets mock win, then ComfyUI when chosen, else the deployment', () => {
    expect(animationProvider({ provider: 'comfyui', useMockGeneration: true })).toBe('mock');
    expect(animationProvider({ provider: 'comfyui', useMockGeneration: false })).toBe('comfyui');
    expect(animationProvider({ provider: 'default', useMockGeneration: false })).toBeUndefined();
  });
});
