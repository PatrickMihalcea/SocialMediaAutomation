/**
 * Export sizes for beat-slideshow video output.
 *
 * These are the real delivery formats, so they name the destination. Image
 * presets deliberately do not — see ../ai/image-sizes.ts for why the shapes
 * cannot be made to match.
 */
export const VIDEO_OUTPUT_PRESETS = [
  {
    id: '1080x1920',
    width: 1080,
    height: 1920,
    label: 'Vertical 9:16 · 1080×1920 (Reels, Shorts, TikTok)',
  },
  {
    id: '1920x1080',
    width: 1920,
    height: 1080,
    label: 'Widescreen 16:9 · 1920×1080 (YouTube)',
  },
  {
    id: '1080x1080',
    width: 1080,
    height: 1080,
    label: 'Square 1:1 · 1080×1080 (Instagram feed)',
  },
] as const;

export type VideoOutputSize = (typeof VIDEO_OUTPUT_PRESETS)[number]['id'];

export const VIDEO_OUTPUT_SIZE_VALUES = VIDEO_OUTPUT_PRESETS.map((preset) => preset.id) as [
  VideoOutputSize,
  ...VideoOutputSize[],
];

export const DEFAULT_VIDEO_OUTPUT_SIZE: VideoOutputSize = '1080x1920';

const PRESET_BY_ID = new Map(VIDEO_OUTPUT_PRESETS.map((preset) => [preset.id, preset]));

export function isVideoOutputSize(value: string): value is VideoOutputSize {
  return PRESET_BY_ID.has(value as VideoOutputSize);
}

export function videoOutputPresetLabel(size: VideoOutputSize): string {
  return PRESET_BY_ID.get(size)!.label;
}

export function resolveVideoOutputSize(size: VideoOutputSize): { width: number; height: number } {
  const preset = PRESET_BY_ID.get(size);
  if (!preset) throw new Error(`Unknown video output size "${size}".`);
  return { width: preset.width, height: preset.height };
}

export function matchVideoOutputPreset(
  width: number,
  height: number,
): VideoOutputSize | null {
  const match = VIDEO_OUTPUT_PRESETS.find(
    (preset) => preset.width === width && preset.height === height,
  );
  return match?.id ?? null;
}

/**
 * Resolves output dimensions from a preset key or legacy width/height fields.
 * Preset `size` wins when both are present. Empty configs default to vertical.
 * Partial or non-integer leftover dimensions fail instead of silently resizing.
 */
export function resolveVideoOutputDimensions(config: {
  size?: string;
  width?: number;
  height?: number;
}): { width: number; height: number; size: VideoOutputSize | null } {
  if (config.size) {
    if (!isVideoOutputSize(config.size)) {
      throw new Error(`Unknown video output size "${config.size}".`);
    }
    const preset = resolveVideoOutputSize(config.size);
    return { ...preset, size: config.size };
  }

  const hasWidth = config.width !== undefined;
  const hasHeight = config.height !== undefined;
  if (hasWidth || hasHeight) {
    const width = config.width;
    const height = config.height;
    if (
      typeof width === 'number'
      && typeof height === 'number'
      && Number.isInteger(width)
      && Number.isInteger(height)
      && width > 0
      && height > 0
    ) {
      return {
        width,
        height,
        size: matchVideoOutputPreset(width, height),
      };
    }
    throw new Error('Video output width and height must both be positive integers.');
  }

  const fallback = resolveVideoOutputSize(DEFAULT_VIDEO_OUTPUT_SIZE);
  return { ...fallback, size: DEFAULT_VIDEO_OUTPUT_SIZE };
}
