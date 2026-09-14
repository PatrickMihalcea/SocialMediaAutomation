import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_SIZE,
  IMAGE_SIZE_LABELS,
  IMAGE_SIZE_PRESETS,
  IMAGE_SIZE_VALUES,
  imageSizeFitNote,
  imageSizeLabel,
} from '@/lib/ai/image-sizes';

describe('image size presets', () => {
  it('offers exactly the dimensions the image model accepts', () => {
    // Repeated on purpose: the provider rejects anything else, so a preset
    // added here has to fail until openai.ts accepts it too.
    expect([...IMAGE_SIZE_VALUES].sort()).toEqual(['1024x1024', '1024x1536', '1536x1024']);
  });

  it('names each preset by shape, not by delivery platform', () => {
    // The model offers no 9:16, so labelling 2:3 "Reels" — while the video
    // presets label 9:16 "Reels" — promises a match that does not exist.
    expect(imageSizeLabel('1024x1536')).toBe('Portrait 2:3 · 1024×1536');
    expect(imageSizeLabel('1536x1024')).toBe('Landscape 3:2 · 1536×1024');
    expect(imageSizeLabel('1024x1024')).toBe('Square 1:1 · 1024×1024');
    for (const preset of IMAGE_SIZE_PRESETS) {
      expect(preset.label).not.toMatch(/reels|shorts|tiktok|youtube/i);
    }
  });

  it('states the crop for shapes that do not fit their video format', () => {
    expect(imageSizeFitNote('1024x1536')).toContain('16%');
    expect(imageSizeFitNote('1536x1024')).toContain('16%');
    expect(imageSizeFitNote('1024x1024')).toBe('Fits square video (1:1) exactly.');
    expect(imageSizeFitNote('1080x1920')).toBeNull();
  });

  it('labels every preset and keeps the dimensions visible', () => {
    for (const preset of IMAGE_SIZE_PRESETS) {
      const [width, height] = preset.id.split('x');
      expect(IMAGE_SIZE_LABELS[preset.id]).toBe(preset.label);
      expect(preset.label).toContain(`${width}×${height}`);
    }
  });

  it('defaults to portrait, the shape that crops cleanly into vertical video', () => {
    expect(DEFAULT_IMAGE_SIZE).toBe('1024x1536');
    expect(IMAGE_SIZE_VALUES).toContain(DEFAULT_IMAGE_SIZE);
  });

  it('falls back to the raw value for a size it does not know', () => {
    expect(imageSizeLabel('1080x1920')).toBe('1080x1920');
  });
});
