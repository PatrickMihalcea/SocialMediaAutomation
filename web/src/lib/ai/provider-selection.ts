export type AiProviderName = 'mock' | 'openai';

/**
 * Image generation can come from a source text generation has no equivalent
 * for: the `image-use` CLI, which renders against a subscription rather than
 * an API key. That is an image-only provider, so it widens the image name
 * union without widening AI_PROVIDER.
 */
export type ImageProviderName = AiProviderName | 'image-use';
export type ImageProviderSetting = 'inherit' | ImageProviderName;

/** Resolves the image-specific override without importing server environment. */
export function resolveImageProviderName(
  textProvider: AiProviderName,
  imageProvider: ImageProviderSetting,
): ImageProviderName {
  return imageProvider === 'inherit' ? textProvider : imageProvider;
}
