export const OVERLAY_STRUCTURES = [
  'numbered',
  'opening-only',
  'opening-always',
  'titles',
  'opening-numbered',
  'numbered-title',
  'opening-numbered-title',
] as const;

export type OverlayStructure = (typeof OVERLAY_STRUCTURES)[number];

export function isOverlayStructure(value: unknown): value is OverlayStructure {
  return typeof value === 'string' && (OVERLAY_STRUCTURES as readonly string[]).includes(value);
}

/** Structures that read Opening text. The others ignore that field. */
export function overlayUsesOpening(structure: OverlayStructure): boolean {
  return (
    structure === 'opening-only'
    || structure === 'opening-always'
    || structure === 'opening-numbered'
    || structure === 'opening-numbered-title'
  );
}

/**
 * The two templates a structure expands into.
 *
 * `first` is text used only on cut 0. Null means cut 0 uses `rest`, like every
 * other cut — including "opening text always", which is the opening line
 * repeated rather than a different first card.
 */
export function overlayPatterns(
  structure: OverlayStructure,
  openingText: string,
): { first: string | null; rest: string } {
  const opening = openingText.trim();
  switch (structure) {
    case 'numbered':
      return { first: null, rest: '{index}' };
    case 'opening-only':
      return { first: opening, rest: '' };
    case 'opening-always':
      return { first: null, rest: opening };
    case 'titles':
      return { first: null, rest: '{title}' };
    case 'opening-numbered':
      return { first: opening || null, rest: '{index}' };
    case 'numbered-title':
      return { first: null, rest: '{index}: {title}' };
    case 'opening-numbered-title':
      return { first: opening || null, rest: '{index}: {title}' };
  }
}

/**
 * Reads Overlay structure out of a saved step, including ones saved before
 * the field existed.
 *
 * The old control was a freeform template plus an optional opening line. Each
 * of the named structures is one of those combinations, so a saved `{index}`
 * with opening text becomes "Opening text, numbered" rather than snapping to
 * Numbered and dropping the opening card.
 */
export function inferOverlayStructure(config: {
  structure?: unknown;
  template?: unknown;
  firstTemplate?: unknown;
}): OverlayStructure {
  if (isOverlayStructure(config.structure)) return config.structure;

  const template = typeof config.template === 'string' ? config.template : '{index}';
  const opening = typeof config.firstTemplate === 'string' && config.firstTemplate.trim() !== '';

  if (opening && template === '') return 'opening-only';
  if (opening && isNumberedTitle(template)) return 'opening-numbered-title';
  if (opening) return 'opening-numbered';
  if (template === '{title}') return 'titles';
  if (isNumberedTitle(template)) return 'numbered-title';
  // The retired "No changing text" preset was an empty template and no opening.
  // There is no empty structure now; leave the cuts unlabelled the same way.
  if (template === '') return 'opening-only';
  return 'numbered';
}

function isNumberedTitle(template: string): boolean {
  return template === '{index}: {title}' || template === '{index}. {title}';
}

export function renderTextOverlayLabels(
  template: string,
  firstTemplate: string | null,
  segments: Array<{ index: number; title: string | null }>,
): string[] {
  // An opening card is not one of the numbered cuts, so it shifts the numbering
  // of everything after it.
  const hasOpening = firstTemplate !== null;
  return segments.map((segment) =>
    renderTemplate(
      segment.index === 0 && firstTemplate !== null ? firstTemplate : template,
      segment,
      hasOpening,
    ),
  );
}

function renderTemplate(
  template: string,
  segment: { index: number; title: string | null },
  hasOpening: boolean,
): string {
  /**
   * The number counts the cuts that actually carry a number, from one.
   *
   * With an opening card that card is not numbered, so the first numbered cut
   * is 1. Numbering it 2 — which is what counting the card produced — is not
   * something anyone writing "1, 2, 3" over a video wants, and the config
   * panel's own preview has always shown 1 for it, so the render disagreed with
   * the preview that sold it.
   *
   * Floored at one because the opening card itself goes through here too: a
   * number token in the opening copy is a strange thing to write, but it should
   * not be able to produce a zero.
   */
  const number = Math.max(1, hasOpening ? segment.index : segment.index + 1);

  return template
    .replace(/\{index\}/g, String(number))
    // {choice} was a second, competing number that started after the opening
    // card while {index} counted it. Only one of those is ever wanted, so the
    // two now mean the same thing and only {index} is offered. This stays
    // because saved workflows still hold it, and an unreplaced token burns the
    // literal text "{choice}" into the video.
    .replace(/\{choice\}/g, String(number))
    .replace(/\{title\}/g, overlayTitle(segment.title))
    .trim();
}

/**
 * Titles burnt onto a cut should read as the title, not the file.
 *
 * Media library titles are already humanised, but a raw filename can still
 * arrive from an older graph. Stripping the extension here is the last place
 * that can stop "cabin.png" from appearing on screen.
 */
export function overlayTitle(title: string | null | undefined): string {
  if (!title) return '';
  return title.replace(/\.(png|jpe?g|gif|webp|svg|mp4|mov|webm|m4v|avif)$/i, '').trim();
}
