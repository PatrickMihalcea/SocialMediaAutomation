import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIDEO_OUTPUT_SIZE,
  VIDEO_OUTPUT_PRESETS,
  matchVideoOutputPreset,
  resolveVideoOutputDimensions,
  resolveVideoOutputSize,
  videoOutputPresetLabel,
} from '@/lib/workflows/video-output-presets';
import { IMAGE_SIZE_PRESETS } from '@/lib/ai/image-sizes';

describe('video output presets', () => {
  it('maps every preset id to its dimensions', () => {
    expect(resolveVideoOutputSize('1080x1920')).toEqual({ width: 1080, height: 1920 });
    expect(resolveVideoOutputSize('1920x1080')).toEqual({ width: 1920, height: 1080 });
    expect(resolveVideoOutputSize('1080x1080')).toEqual({ width: 1080, height: 1080 });
  });

  it('names the shape and the destination, since these are the real formats', () => {
    expect(videoOutputPresetLabel('1080x1920')).toBe('Vertical 9:16 · 1080×1920 (Reels, Shorts, TikTok)');
    expect(videoOutputPresetLabel('1920x1080')).toBe('Widescreen 16:9 · 1920×1080 (YouTube)');
    expect(videoOutputPresetLabel('1080x1080')).toBe('Square 1:1 · 1080×1080 (Instagram feed)');
  });

  it('only claims a destination for image shapes that actually fit it', () => {
    // 2:3 is not 9:16. Both pickers naming the same platform made them look
    // interchangeable, so a destination name now has to survive this check.
    const videoRatios = VIDEO_OUTPUT_PRESETS.map((preset) => preset.label.split(' ')[1]);
    expect(videoRatios).toEqual(['9:16', '16:9', '1:1']);
    for (const image of IMAGE_SIZE_PRESETS) {
      const ratio = image.label.split(' ')[1];
      if (image.cropsInto === 0) expect(videoRatios).toContain(ratio);
      else expect(videoRatios).not.toContain(ratio);
    }
  });

  it('recognises preset dimensions', () => {
    expect(matchVideoOutputPreset(1080, 1920)).toBe('1080x1920');
    expect(matchVideoOutputPreset(1280, 720)).toBeNull();
  });

  it('prefers size over legacy width and height', () => {
    expect(
      resolveVideoOutputDimensions({ size: '1920x1080', width: 1080, height: 1920 }),
    ).toEqual({ width: 1920, height: 1080, size: '1920x1080' });
  });

  it('accepts legacy width and height without size', () => {
    expect(resolveVideoOutputDimensions({ width: 1920, height: 1080 })).toEqual({
      width: 1920,
      height: 1080,
      size: '1920x1080',
    });
  });

  it('defaults to vertical when nothing is set', () => {
    expect(resolveVideoOutputDimensions({})).toEqual({
      width: 1080,
      height: 1920,
      size: DEFAULT_VIDEO_OUTPUT_SIZE,
    });
  });

  it('keeps non-preset legacy dimensions without forcing a preset id', () => {
    expect(resolveVideoOutputDimensions({ width: 1280, height: 720 })).toEqual({
      width: 1280,
      height: 720,
      size: null,
    });
  });

  it('rejects leftover dimensions that are incomplete or non-integer', () => {
    expect(() => resolveVideoOutputDimensions({ width: 1920 })).toThrow(/positive integers/);
    expect(() => resolveVideoOutputDimensions({ width: 1920.5, height: 1080 })).toThrow(
      /positive integers/,
    );
    expect(() => resolveVideoOutputDimensions({ size: '1024x1536' })).toThrow(/Unknown video output size/);
  });
});
