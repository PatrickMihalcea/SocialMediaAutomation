export type AiProviderName = 'mock' | 'openai';
export type ImageProviderSetting = 'inherit' | AiProviderName;

/** Resolves the image-specific override without importing server environment. */
export function resolveImageProviderName(
  textProvider: AiProviderName,
  imageProvider: ImageProviderSetting,
): AiProviderName {
  return imageProvider === 'inherit' ? textProvider : imageProvider;
}
