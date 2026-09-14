export function renderTextOverlayLabels(
  template: string,
  firstTemplate: string | null,
  segments: Array<{ index: number; title: string | null }>,
): string[] {
  return segments.map((segment) =>
    renderTemplate(segment.index === 0 && firstTemplate ? firstTemplate : template, segment),
  );
}

function renderTemplate(
  template: string,
  segment: { index: number; title: string | null },
): string {
  return template
    .replace(/\{index\}/g, String(segment.index + 1))
    .replace(/\{choice\}/g, String(Math.max(0, segment.index)))
    .replace(/\{title\}/g, segment.title ?? '')
    .trim();
}
