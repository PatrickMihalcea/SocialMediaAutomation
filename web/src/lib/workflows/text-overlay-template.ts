export function renderTextOverlayLabels(
  template: string,
  firstTemplate: string | null,
  segments: Array<{ index: number; title: string | null }>,
): string[] {
  // An opening card is not one of the numbered cuts, so it shifts the numbering
  // of everything after it.
  const hasOpening = Boolean(firstTemplate);
  return segments.map((segment) =>
    renderTemplate(
      segment.index === 0 && firstTemplate ? firstTemplate : template,
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
    .replace(/\{title\}/g, segment.title ?? '')
    .trim();
}
