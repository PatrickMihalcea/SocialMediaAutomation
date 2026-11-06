import { describe, expect, it } from 'vitest';
import { stepRunsLocally } from '@/lib/workflows/local-steps';

describe('which steps wait for the local worker', () => {
  it('sends an image step set to ComfyUI to the Mac, and leaves the rest in the cloud', () => {
    expect(stepRunsLocally('IMAGE_GENERATOR', { provider: 'comfyui' })).toBe(true);
    expect(stepRunsLocally('IMAGE_GENERATOR', { provider: 'image-use' })).toBe(false);
    expect(stepRunsLocally('IMAGE_GENERATOR', {})).toBe(false);
  });

  it('sends an animate step set to ComfyUI to the Mac', () => {
    expect(stepRunsLocally('ANIMATE_IMAGE', { provider: 'comfyui' })).toBe(true);
    expect(stepRunsLocally('ANIMATE_IMAGE', {})).toBe(false);
  });

  /** A placeholder has no reason to wait for a laptop that may be closed. */
  it('keeps a mocked step in the cloud whatever its provider says', () => {
    expect(stepRunsLocally('IMAGE_GENERATOR', { provider: 'comfyui', useMockGeneration: true })).toBe(false);
    expect(stepRunsLocally('ANIMATE_IMAGE', { provider: 'comfyui', useMockGeneration: true })).toBe(false);
  });

  it('leaves a config that no longer parses where it will fail visibly', () => {
    expect(stepRunsLocally('IMAGE_GENERATOR', { provider: 'comfyui', maxImages: 999 })).toBe(false);
    expect(stepRunsLocally('TEXT_OVERLAY', { provider: 'comfyui' })).toBe(false);
  });
});
