/**
 * The sizes the image model will generate.
 *
 * The three ratios are fixed by the provider — 2:3, 3:2 and 1:1 — and none of
 * them is 9:16. So these are labelled by shape, not by destination: calling 2:3
 * "Reels" while the video presets call 9:16 "Reels" reads as a promise that the
 * two match, and they do not. `cropsInto` carries the real cost of composing
 * each shape into its matching video format, which the UI states outright.
 *
 * Client-safe: imported by the AI studio and the workflow config panel.
 */
export const IMAGE_SIZE_PRESETS = [
  {
    id: '1024x1536',
    label: 'Portrait 2:3 · 1024×1536',
    /** The video format this shape is meant to be composed into. */
    suits: 'vertical video (9:16)',
    /** Roughly how much a fill-frame render discards. 0 means an exact fit. */
    cropsInto: 16,
  },
  {
    id: '1536x1024',
    label: 'Landscape 3:2 · 1536×1024',
    suits: 'widescreen video (16:9)',
    cropsInto: 16,
  },
  {
    id: '1024x1024',
    label: 'Square 1:1 · 1024×1024',
    suits: 'square video (1:1)',
    cropsInto: 0,
  },
] as const;

export type ImageSize = (typeof IMAGE_SIZE_PRESETS)[number]['id'];

export const IMAGE_SIZE_VALUES = IMAGE_SIZE_PRESETS.map((preset) => preset.id) as [
  ImageSize,
  ...ImageSize[],
];

/** Portrait: the closest shape the model offers to vertical video. */
export const DEFAULT_IMAGE_SIZE: ImageSize = '1024x1536';

export const IMAGE_SIZE_LABELS: Record<ImageSize, string> = Object.fromEntries(
  IMAGE_SIZE_PRESETS.map((preset) => [preset.id, preset.label]),
) as Record<ImageSize, string>;

export function imageSizeLabel(size: string): string {
  return IMAGE_SIZE_LABELS[size as ImageSize] ?? size;
}

/**
 * What composing this image shape into its matching video format costs, as a
 * sentence. Exists so the config panel and the guide cannot drift apart on it.
 */
export function imageSizeFitNote(size: string): string | null {
  const preset = IMAGE_SIZE_PRESETS.find((candidate) => candidate.id === size);
  if (!preset) return null;
  if (preset.cropsInto === 0) return `Fits ${preset.suits} exactly.`;
  return `Suits ${preset.suits}, which crops about ${preset.cropsInto}% unless Beat slideshow is set to show the full image.`;
}
