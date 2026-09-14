import 'server-only';
import sharp from 'sharp';
import type { RenderImage } from '@/lib/render/types';

/**
 * Image preparation, in sharp rather than ffmpeg.
 *
 * Three reasons: libvips' Lanczos is faster and more deterministic than
 * swscale, it removes a whole class of scaler-version variation from the
 * output, and — the one that matters most — this step still works when ffmpeg
 * is missing, which is what lets a machine with no encoder produce a storyboard
 * instead of nothing at all.
 */

export interface LayoutOptions {
  width: number;
  height: number;
  supersample: number;
  fit: 'cover' | 'blur-pad';
  /** Burned in here when ffmpeg has no drawtext filter. */
  label?: { text: string; font: string; fontSize: number } | null;
}

export async function prepareImage(bytes: Buffer, options: LayoutOptions): Promise<RenderImage> {
  const width = options.width * options.supersample;
  const height = options.height * options.supersample;

  let canvas =
    options.fit === 'blur-pad'
      ? await blurPad(bytes, width, height)
      : await sharp(bytes)
          // cover crops to fill. A 2:3 source on a 9:16 canvas loses about 200px
          // from each side, which is why blur-pad exists as the alternative.
          .resize(width, height, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
          .toBuffer();

  if (options.label) {
    canvas = await burnLabel(canvas, width, height, options.label);
  }

  return {
    // Fast compression: this is an intermediate, so disk is cheaper than CPU.
    bytes: await sharp(canvas).png({ compressionLevel: 1 }).toBuffer(),
    mimeType: 'image/png',
  };
}

/** Keeps the whole composition over a blurred copy of itself. */
async function blurPad(bytes: Buffer, width: number, height: number): Promise<Buffer> {
  const background = await sharp(bytes)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .blur(60)
    .toBuffer();
  const foreground = await sharp(bytes)
    .resize(width, height, { fit: 'inside', kernel: 'lanczos3' })
    .toBuffer();
  return sharp(background)
    .composite([{ input: foreground, gravity: 'centre' }])
    .toBuffer();
}

/**
 * Fallback label rendering for builds without drawtext.
 *
 * Lower fidelity than the ffmpeg path on purpose: librsvg resolves the family
 * through fontconfig, so it falls back to a system sans rather than using the
 * bundled Archivo file. The alternative is no label at all.
 */
async function burnLabel(
  canvas: Buffer,
  width: number,
  height: number,
  label: NonNullable<LayoutOptions['label']>,
): Promise<Buffer> {
  const lines = label.text.split('\n');
  const lineHeight = label.fontSize * 1.15;
  const top = height * 0.11;

  const text = lines
    .map(
      (line, i) =>
        `<text x="${width / 2}" y="${top + lineHeight * (i + 1)}" text-anchor="middle" ` +
        `font-family="${escapeXml(familyFor(label.font))}" font-size="${label.fontSize}" ` +
        `font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="${Math.round(label.fontSize * 0.08)}" ` +
        `paint-order="stroke">${escapeXml(line)}</text>`,
    )
    .join('');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${text}</svg>`;
  return sharp(canvas)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toBuffer();
}

const familyFor = (font: string) =>
  font.startsWith('Bebas')
    ? 'Bebas Neue, Oswald, Impact, sans-serif'
    : 'Archivo, Helvetica Neue, Helvetica, Arial, sans-serif';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
