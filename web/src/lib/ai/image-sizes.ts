import type { ImageProviderName } from '@/lib/ai/provider-selection';

/**
 * The sizes an image provider will generate.
 *
 * Which ones are available depends on the provider, and the difference is not
 * cosmetic: the OpenAI image API offers 2:3, 3:2 and 1:1 and nothing else, so
 * a vertical video frame has to be cropped out of a 2:3 image. The subscription
 * backend honours a requested ratio instead — asking for 9:16 returned
 * 941x1672, measured — which is an exact vertical frame and no crop at all.
 *
 * `requires` names the provider a size needs; null means every provider has it.
 * The pixel count is a request either way — the subscription backend normalises
 * it (1024x1024 came back 1254x1254) while keeping the ratio — so `cropsInto`
 * describes the shape, not the resolution.
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
    requires: null,
  },
  {
    id: '1536x1024',
    label: 'Landscape 3:2 · 1536×1024',
    suits: 'widescreen video (16:9)',
    cropsInto: 16,
    requires: null,
  },
  {
    id: '1024x1024',
    label: 'Square 1:1 · 1024×1024',
    suits: 'square video (1:1)',
    cropsInto: 0,
    requires: null,
  },
  {
    id: '1024x1820',
    label: 'Vertical 9:16 · 1024×1820',
    suits: 'vertical video (9:16)',
    cropsInto: 0,
    /** Only the subscription backend renders a true 9:16; the API has no such size. */
    requires: 'image-use',
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

/** The only sizes the OpenAI image API accepts. Anything else is a 400. */
export const OPENAI_IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;
export type OpenAiImageSize = (typeof OPENAI_IMAGE_SIZES)[number];

export function isOpenAiImageSize(size: string): size is OpenAiImageSize {
  return (OPENAI_IMAGE_SIZES as readonly string[]).includes(size);
}

/**
 * Whether a provider can produce this shape.
 *
 * An unknown provider — a workflow step left on the deployment default — is
 * allowed through, because the answer depends on configuration the browser
 * cannot see. The provider itself refuses rather than silently reshaping.
 */
export function imageSizeAvailableFor(size: string, provider?: ImageProviderName): boolean {
  const preset = IMAGE_SIZE_PRESETS.find((candidate) => candidate.id === size);
  if (!preset) return false;
  if (!preset.requires || !provider) return true;
  // `requires` names the real backend a shape needs. The mock is not one: it
  // rasterises its placeholder at whatever dimensions it is handed, so gating a
  // size on a paid backend only stopped demo mode from exercising the shape it
  // exists to exercise — a vertical video workflow could not be run at all
  // without switching to a provider that charges for it.
  if (provider === 'mock') return true;
  return preset.requires === provider;
}

export function imageSizesFor(provider?: ImageProviderName): ImageSize[] {
  return IMAGE_SIZE_PRESETS.filter((preset) => imageSizeAvailableFor(preset.id, provider)).map(
    (preset) => preset.id,
  );
}
