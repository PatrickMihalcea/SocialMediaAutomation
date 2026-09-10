export const GENERATED_MEDIA_PRESETS = [
  'IMAGE_GENERATE',
  'IMAGE_EDIT',
  'IMAGE_VARIATION',
  'VIDEO_GENERATE',
  'VIDEO_ANIMATE',
  'AUDIO_TTS',
] as const;

export type MediaAssetKind = 'ORIGINAL' | 'DERIVATIVE' | 'GENERATED';

export function classifyMediaAsset(asset: {
  aiGenerationId: string | null;
  derivedFromId: string | null;
  derivationPreset: string | null;
}): MediaAssetKind {
  if (
    asset.aiGenerationId
    || GENERATED_MEDIA_PRESETS.includes(asset.derivationPreset as (typeof GENERATED_MEDIA_PRESETS)[number])
  ) {
    return 'GENERATED';
  }
  return asset.derivedFromId ? 'DERIVATIVE' : 'ORIGINAL';
}
