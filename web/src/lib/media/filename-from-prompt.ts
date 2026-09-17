/**
 * A filename that says what the thing is.
 *
 * "ai-image-generate.png" tells a person nothing once it is one row among
 * forty in the Media Library — they have to open each one to find the picture
 * they asked for. The brief is the only description that exists at the moment
 * the file is written, so it becomes the name.
 *
 * Client-safe: no storage or database imports, so the studio can show the name
 * it is about to create.
 */

/** Long enough to distinguish two briefs, short enough to read in a list. */
const MAX_WORDS = 7;
const MAX_LENGTH = 48;

/**
 * Words that describe the medium rather than the subject. A brief very often
 * opens with them ("a photo of a red bicycle"), and spending three of seven
 * words on "a photo of" pushes the part that identifies the image out.
 */
const LEADING_NOISE = new Set([
  'a', 'an', 'the', 'of', 'with', 'and', 'in', 'on', 'for',
  'image', 'photo', 'photograph', 'picture', 'illustration', 'render', 'rendering',
  'generate', 'create', 'draw', 'make', 'design', 'show', 'showing',
]);

export function filenameFromPrompt(prompt: string, extension: string, fallback = 'generated'): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);

  // Only from the front: "a photo of a red bicycle in the rain" should keep
  // "rain", and dropping these words everywhere would also strip the "of" from
  // a phrase that needs it.
  let start = 0;
  while (start < words.length && LEADING_NOISE.has(words[start])) start += 1;
  // All noise means the brief was something like "draw a picture" — better to
  // keep those words than to name the file nothing at all.
  const meaningful = start < words.length ? words.slice(start) : words;

  const name = meaningful.slice(0, MAX_WORDS).join('-').slice(0, MAX_LENGTH).replace(/-+$/, '');
  return `${name || fallback}.${extension}`;
}
