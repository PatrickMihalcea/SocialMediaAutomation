import path from 'node:path';
import { env } from '@/lib/env';

/**
 * Fonts are addressed by absolute file path, never by family name.
 *
 * `drawtext`'s `font=` resolves through fontconfig against whatever the host
 * machine has cached, which is neither reproducible nor usually present in a
 * slim container. The old Python code mixed both approaches — PIL loaded a
 * relative path while MoviePy asked for the family "Archivo-Regular" — which is
 * why it needed the X11 registration files sitting in the repo.
 */
export const RENDER_FONTS = ['Archivo-Bold', 'Archivo-SemiBold', 'BebasNeue-Regular'] as const;

export type RenderFont = (typeof RENDER_FONTS)[number];

export function fontDir(): string {
  return env.RENDER_FONT_DIR || path.join(process.cwd(), 'assets', 'fonts');
}

export function fontFile(font: string): string {
  const name = (RENDER_FONTS as readonly string[]).includes(font) ? font : 'Archivo-Bold';
  return path.join(fontDir(), `${name}.ttf`);
}

/**
 * Average advance width as a fraction of the em, per face.
 *
 * Measured rather than computed: reading real glyph metrics would mean adding a
 * font parser, and the labels this renders are short — a number, or two or three
 * words. The 12% safety margin in `fitFontSize` covers the error. A label that
 * still overflows is handled by setting an explicit font size on the step.
 */
const ADVANCE_RATIO: Record<string, number> = {
  'Archivo-Bold': 0.56,
  'Archivo-SemiBold': 0.54,
  // A condensed face: much narrower per character, which is why it exists here.
  'BebasNeue-Regular': 0.38,
};

export function estimateWidth(text: string, font: string, fontSize: number): number {
  const ratio = ADVANCE_RATIO[font] ?? 0.56;
  const longest = text.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
  return longest * ratio * fontSize;
}

/**
 * Largest size at which the label fits the safe width, searched rather than
 * computed so the ratio table only has to be approximately right.
 */
export function fitFontSize(input: {
  text: string;
  font: string;
  maxWidth: number;
  min?: number;
  max?: number;
}): number {
  const min = input.min ?? 48;
  const max = input.max ?? 200;
  const safe = input.maxWidth * 0.88;

  let low = min;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateWidth(input.text, input.font, mid) <= safe) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Wraps to literal newlines, which `drawtext` honours via `line_spacing`. It has
 * no wrapping of its own, so all of it happens here.
 */
export function wrapLabel(text: string, font: string, fontSize: number, maxWidth: number): string {
  const safe = maxWidth * 0.88;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateWidth(candidate, font, fontSize) <= safe || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}
