export type AiProviderName = 'mock' | 'openai';

/**
 * Image generation can come from a source text generation has no equivalent
 * for: the `image-use` CLI, which renders against a subscription rather than
 * an API key. That is an image-only provider, so it widens the image name
 * union without widening AI_PROVIDER.
 */
export type ImageProviderName = AiProviderName | 'image-use' | 'comfyui';
export type ImageProviderSetting = 'inherit' | ImageProviderName;

/** Resolves the image-specific override without importing server environment. */
export function resolveImageProviderName(
  textProvider: AiProviderName,
  imageProvider: ImageProviderSetting,
): ImageProviderName {
  return imageProvider === 'inherit' ? textProvider : imageProvider;
}

/**
 * Whether a provider can only run on the operator's own machine.
 *
 * ComfyUI listens on that machine's localhost, so work for it is queued for
 * the local worker (LOCAL_QUEUE) instead of being run wherever it was asked.
 */
export function runsLocally(provider: string | null | undefined): boolean {
  return provider === 'comfyui';
}
