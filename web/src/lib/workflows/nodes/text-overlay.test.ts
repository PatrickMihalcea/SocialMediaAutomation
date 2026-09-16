import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/env', () => ({ env: {} }));
vi.mock('@/lib/storage', () => ({ mediaKey: vi.fn(), storage: vi.fn() }));
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn() }));
vi.mock('@/lib/media/process', () => ({ ffmpegCapabilities: vi.fn() }));
vi.mock('sharp', () => ({ default: vi.fn() }));

import { cutPointsOf, overlayFontSizes } from '@/lib/workflows/nodes/text-overlay';

const point = (index: number) => ({
  index,
  mediaAssetId: `asset-${index}`,
  mediaKind: 'IMAGE' as const,
  startFrame: index * 30,
  endFrame: (index + 1) * 30,
  startSeconds: index,
  endSeconds: index + 1,
  title: `Clip ${index}`,
});

describe('cutPointsOf', () => {
  it('reads the cut points a slideshow recorded on its video', () => {
    const preset = JSON.stringify({ kind: 'beat-video', cutPoints: [point(0), point(1)] });

    expect(cutPointsOf(preset)).toEqual([point(0), point(1)]);
  });

  // Each of these means the video did not come from a slideshow, so the step
  // has to say so rather than render a video with no labels on it.
  it.each([
    ['no record at all', null],
    ['an unparseable record', '{not json'],
    ['a video derived some other way', JSON.stringify({ kind: 'text-overlay', labels: ['1'] })],
    ['an empty list', JSON.stringify({ kind: 'beat-video', cutPoints: [] })],
    ['a list that is not one', JSON.stringify({ kind: 'beat-video', cutPoints: 'two' })],
  ])('returns null for %s', (_label, preset) => {
    expect(cutPointsOf(preset)).toBeNull();
  });

  // Frame bounds are what the label graph is built from, so a record carrying
  // titles but no frames would otherwise fail deeper in ffmpeg.
  it('returns null when a cut point is missing its frame bounds', () => {
    const preset = JSON.stringify({
      kind: 'beat-video',
      cutPoints: [point(0), { index: 1, title: 'Clip 1' }],
    });

    expect(cutPointsOf(preset)).toBeNull();
  });
});

describe('overlayFontSizes', () => {
  it('fits an opening separately from its short choice labels', () => {
    const sizes = overlayFontSizes({
      labels: ['Which treehouse would you choose for a week in the forest?', '1', '2', '3'],
      hasOpening: true,
      configuredSize: 0,
      font: 'Archivo-Bold',
      width: 1080,
    });

    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes.slice(1)).toEqual([sizes[1], sizes[1], sizes[1]]);
  });

  it('keeps one automatic size when there is no separate opening', () => {
    const sizes = overlayFontSizes({
      labels: ['Option one', 'A much longer option two'],
      hasOpening: false,
      configuredSize: 0,
      font: 'Archivo-Bold',
      width: 1080,
    });

    expect(new Set(sizes).size).toBe(1);
  });

  it('uses the explicit size for every label', () => {
    expect(overlayFontSizes({
      labels: ['A long opening', '1', '2'],
      hasOpening: true,
      configuredSize: 96,
      font: 'Archivo-Bold',
      width: 1080,
    })).toEqual([96, 96, 96]);
  });
});
