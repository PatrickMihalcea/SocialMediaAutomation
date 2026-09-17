import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_SIZE,
  IMAGE_SIZE_LABELS,
  IMAGE_SIZE_PRESETS,
  IMAGE_SIZE_VALUES,
  imageSizeAvailableFor,
  imageSizeFitNote,
  imageSizeLabel,
  imageSizesFor,
  OPENAI_IMAGE_SIZES,
} from '@/lib/ai/image-sizes';

describe('image size presets', () => {
  it('offers the OpenAI API exactly the dimensions it accepts', () => {
    // Repeated on purpose: that provider rejects anything else, so a preset
    // added for it has to fail here until openai.ts accepts it too.
    expect([...imageSizesFor('openai')].sort()).toEqual(['1024x1024', '1024x1536', '1536x1024']);
    expect([...OPENAI_IMAGE_SIZES].sort()).toEqual(['1024x1024', '1024x1536', '1536x1024']);
  });

  /**
   * The one shape worth having a second provider for: 2:3 loses 16% of its
   * width to a vertical video frame, and 9:16 loses nothing.
   */
  it('offers a true vertical frame only where a provider can render one', () => {
    expect(imageSizesFor('image-use')).toContain('1024x1820');
    expect(imageSizesFor('openai')).not.toContain('1024x1820');
    expect(imageSizeAvailableFor('1024x1820', 'openai')).toBe(false);
    // Nothing chosen yet — the browser cannot know the deployment's provider,
    // so the size stays on offer and the provider is what refuses it.
    expect(imageSizesFor()).toContain('1024x1820');
  });

  /**
   * Demo mode has to be able to run the workflow it is standing in for. The
   * mock draws its placeholder at whatever dimensions it is given, so gating a
   * shape on a paid backend only made a vertical video impossible to rehearse
   * without paying for it.
   */
  it('offers every shape to the mock, which has no API to refuse them', () => {
    expect(imageSizesFor('mock')).toEqual(IMAGE_SIZE_PRESETS.map((preset) => preset.id));
    expect(imageSizeAvailableFor('1024x1820', 'mock')).toBe(true);
  });

  it('names each preset by shape, not by delivery platform', () => {
    // Labelling 2:3 "Reels" — while the video presets label 9:16 "Reels" —
    // promises a match that does not exist. The 9:16 preset keeps the same
    // convention rather than becoming the one exception on the list.
    expect(imageSizeLabel('1024x1536')).toBe('Portrait 2:3 · 1024×1536');
    expect(imageSizeLabel('1536x1024')).toBe('Landscape 3:2 · 1536×1024');
    expect(imageSizeLabel('1024x1024')).toBe('Square 1:1 · 1024×1024');
    expect(imageSizeLabel('1024x1820')).toBe('Vertical 9:16 · 1024×1820');
    for (const preset of IMAGE_SIZE_PRESETS) {
      expect(preset.label).not.toMatch(/reels|shorts|tiktok|youtube/i);
    }
  });

  it('states the crop for shapes that do not fit their video format', () => {
    expect(imageSizeFitNote('1024x1536')).toContain('16%');
    expect(imageSizeFitNote('1536x1024')).toContain('16%');
    expect(imageSizeFitNote('1024x1024')).toBe('Fits square video (1:1) exactly.');
    expect(imageSizeFitNote('1024x1820')).toBe('Fits vertical video (9:16) exactly.');
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
