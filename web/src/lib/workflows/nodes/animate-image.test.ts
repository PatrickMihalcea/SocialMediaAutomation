import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { animationProvider, expectedClipMs, withCamera, withSound } from '@/lib/workflows/nodes/animate-image';

describe('the camera', () => {
  const instructions = 'Snow falls past the window.';

  it('locks the frame and says the scene still moves', () => {
    expect(withCamera(instructions, { camera: 'locked' })).toMatch(/^Snow falls past the window\. Static shot.*Everything in the scene keeps moving naturally\.$/);
  });

  it('sends a custom camera as written, and nothing at No preference', () => {
    expect(withCamera(instructions, { camera: 'custom', cameraPrompt: 'slow push in toward the window.' }))
      .toBe('Snow falls past the window. Camera: slow push in toward the window.');
    expect(withCamera(instructions, { camera: 'none', cameraPrompt: 'ignored' })).toBe(instructions);
  });
});

describe('which provider animates', () => {
  it('lets mock win, then ComfyUI when chosen, else the deployment', () => {
    expect(animationProvider({ provider: 'comfyui', useMockGeneration: true })).toBe('mock');
    expect(animationProvider({ provider: 'comfyui', useMockGeneration: false })).toBe('comfyui');
    expect(animationProvider({ provider: 'default', useMockGeneration: false })).toBeUndefined();
  });
});

describe('the sound prompt', () => {
  it('adds the sound as its own sentence while sound is on', () => {
    expect(withSound('Slow push in.', { sound: true, soundPrompt: 'wind through ruins, distant thunder.' }))
      .toBe('Slow push in. Sound: wind through ruins, distant thunder.');
  });

  it('leaves the prompt alone while sound is off or nothing is described', () => {
    expect(withSound('Slow push in.', { sound: false, soundPrompt: 'thunder' })).toBe('Slow push in.');
    expect(withSound('Slow push in.', { sound: true, soundPrompt: '   ' })).toBe('Slow push in.');
  });
});

describe('how long a clip should take', () => {
  it('uses this step\'s own clips first, then recent ones, then a guess from the length', () => {
    expect(expectedClipMs([10, 20], 99, 3)).toBe(15);
    expect(expectedClipMs([], 1_080_000, 3)).toBe(1_080_000);
    expect(expectedClipMs([], null, 3)).toBe(18 * 60_000);
  });
});
