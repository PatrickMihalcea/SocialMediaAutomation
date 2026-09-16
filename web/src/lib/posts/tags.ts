/**
 * Turns a typed list of hashtags or mentions into the bare tokens a post
 * stores.
 *
 * Shared by the composer and the workflow publish steps so a tag typed into a
 * step behaves exactly like one typed into the composer. Both commas and
 * whitespace separate, because people type both, and a leading sigil is
 * optional — "#launch, launch" is one tag written two ways.
 */
export function parseTagList(value: string, prefix: '@' | '#'): string[] {
  const pattern = new RegExp(`^\\${prefix}+`);
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim().replace(pattern, ''))
    .filter(Boolean);
}
