import { describe, expect, it } from 'vitest';
import { classifyMediaAsset } from '@/lib/media/classification';

describe('media asset classification', () => {
  it('distinguishes originals, editor derivatives, and generated assets', () => {
    expect(classifyMediaAsset({ aiGenerationId: null, derivedFromId: null, derivationPreset: null })).toBe('ORIGINAL');
    expect(classifyMediaAsset({ aiGenerationId: null, derivedFromId: 'source', derivationPreset: '4:5' })).toBe('DERIVATIVE');
    expect(classifyMediaAsset({ aiGenerationId: null, derivedFromId: null, derivationPreset: 'VIDEO_GENERATE' })).toBe('GENERATED');
    expect(classifyMediaAsset({ aiGenerationId: null, derivedFromId: 'source', derivationPreset: 'IMAGE_VARIATION' })).toBe('GENERATED');
    expect(classifyMediaAsset({ aiGenerationId: 'generation', derivedFromId: null, derivationPreset: null })).toBe('GENERATED');
  });
});
