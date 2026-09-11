// Server-safe: no 'use client' here so server components can call this directly.
const HUMAN_MACHINE_VALUES: Record<string, string> = {
  'ai-image-variation': 'AI image variation',
  'ai-video-generate': 'Generated video',
  'ai-audio-tts': 'AI voiceover',
  'ai-image-variation-edit': 'Edited AI image',
  'text-to-video': 'Video from text',
  'text-to-speech': 'Spoken audio',
  'image-variation': 'AI image variation',
  'video-generate': 'Generated video',
  'audio-tts': 'AI voiceover',
};

/**
 * Converts provider tokens and generated filenames into user-facing labels.
 * A sequence can distinguish repeated generated-video fixtures.
 */
export function humanizeMachineValue(value: string, options: { sequence?: number } = {}) {
  const normalized = value.trim().toLowerCase().replaceAll('_', '-');
  if (/^ai-image-\d+\.(png|jpe?g|webp)$/i.test(normalized)) return 'Generated image';
  if (normalized === 'ai-video-generate.webm') {
    return options.sequence ? `Generated video ${options.sequence}` : 'Generated video';
  }
  const withoutExtension = normalized.replace(/\.[a-z0-9]{2,5}$/i, '');
  const mapped = HUMAN_MACHINE_VALUES[withoutExtension];
  if (mapped) return mapped;
  const readable = withoutExtension
    .replace(/\b\d{10,}\b/g, '')
    .replace(/-+/g, ' ')
    .trim();
  if (!readable) return 'Generated asset';
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}
