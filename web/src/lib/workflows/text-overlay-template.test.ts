import { describe, expect, it } from 'vitest';
import {
  inferOverlayStructure,
  overlayPatterns,
  renderTextOverlayLabels,
  type OverlayStructure,
} from '@/lib/workflows/text-overlay-template';

describe('text overlay templates', () => {
  it('numbers the cuts from one when there is no opening card', () => {
    expect(renderTextOverlayLabels(
      '{index}',
      null,
      [
        { index: 0, title: null },
        { index: 1, title: null },
        { index: 2, title: null },
      ],
    )).toEqual(['1', '2', '3']);
  });

  /**
   * The regression this exists for. The opening card used to be counted as cut
   * one, so the first cut that actually showed a number showed 2 — while the
   * config panel's preview showed 1 for the same template. Nobody writing
   * "1, 2, 3" over a video wants it to start at 2.
   */
  it('does not count an opening card, so the first numbered cut is one', () => {
    expect(renderTextOverlayLabels(
      '{index}',
      'Which treehouse would you choose?',
      [
        { index: 0, title: null },
        { index: 1, title: 'Canopy house' },
        { index: 2, title: 'Pine house' },
      ],
    )).toEqual([
      'Which treehouse would you choose?',
      '1',
      '2',
    ]);
  });

  it('keeps titles alongside the number', () => {
    expect(renderTextOverlayLabels(
      '{index}. {title}',
      null,
      [
        { index: 0, title: 'Canopy house' },
        { index: 1, title: 'Pine house' },
      ],
    )).toEqual(['1. Canopy house', '2. Pine house']);
  });

  describe('{choice}, retired from the picker but still in saved configs', () => {
    it('means the same number as {index} after an opening card', () => {
      expect(renderTextOverlayLabels(
        '{choice}',
        'Which treehouse would you choose?',
        [
          { index: 0, title: null },
          { index: 1, title: 'Canopy house' },
          { index: 2, title: 'Pine house' },
        ],
      )).toEqual([
        'Which treehouse would you choose?',
        '1',
        '2',
      ]);
    });

    /**
     * {choice} was index-based with no floor, so a workflow using it without an
     * opening card labelled its first cut "0". That was reachable from the
     * picker, which offered the token without mentioning it needed a card.
     */
    it('starts at one rather than zero when there is no opening card', () => {
      expect(renderTextOverlayLabels(
        '{choice}',
        null,
        [
          { index: 0, title: null },
          { index: 1, title: null },
        ],
      )).toEqual(['1', '2']);
    });
  });

  it('never renders a number as zero, even in the opening copy', () => {
    expect(renderTextOverlayLabels(
      '{index}',
      'Pick one of {index}',
      [{ index: 0, title: null }, { index: 1, title: null }],
    )).toEqual(['Pick one of 1', '1']);
  });

  it('drops a title token to nothing when no title is connected', () => {
    expect(renderTextOverlayLabels(
      '{index}: {title}',
      null,
      [{ index: 0, title: null }],
    )).toEqual(['1:']);
  });

  it('strips a file extension from a title burnt onto a cut', () => {
    expect(renderTextOverlayLabels(
      '{title}',
      null,
      [{ index: 0, title: 'canopy-house.png' }],
    )).toEqual(['canopy-house']);
  });
});

describe('overlay structure', () => {
  const cuts = [
    { index: 0, title: 'Canopy house.png' },
    { index: 1, title: 'Pine house' },
    { index: 2, title: 'Glass cabin' },
  ];

  function labels(structure: OverlayStructure, opening = 'Which would you choose?') {
    const patterns = overlayPatterns(structure, opening);
    return renderTextOverlayLabels(patterns.rest, patterns.first, cuts);
  }

  it('numbers every cut', () => {
    expect(labels('numbered')).toEqual(['1', '2', '3']);
  });

  it('shows opening text only on the first cut', () => {
    expect(labels('opening-only')).toEqual(['Which would you choose?', '', '']);
  });

  it('repeats opening text on every cut', () => {
    expect(labels('opening-always')).toEqual([
      'Which would you choose?',
      'Which would you choose?',
      'Which would you choose?',
    ]);
  });

  it('shows titles without a file extension', () => {
    expect(labels('titles')).toEqual(['Canopy house', 'Pine house', 'Glass cabin']);
  });

  it('opens then numbers', () => {
    expect(labels('opening-numbered')).toEqual(['Which would you choose?', '1', '2']);
  });

  it('opens then shows each image title', () => {
    expect(labels('opening-titles')).toEqual([
      'Which would you choose?',
      'Pine house',
      'Glass cabin',
    ]);
  });

  it('infers opening-titles from a saved title template plus an opening line', () => {
    expect(inferOverlayStructure({
      template: '{title}',
      firstTemplate: 'Which would you choose?',
    })).toBe('opening-titles');
  });

  it('numbers every cut with a colon and title', () => {
    expect(labels('numbered-title')).toEqual([
      '1: Canopy house',
      '2: Pine house',
      '3: Glass cabin',
    ]);
  });

  it('opens then numbers with a colon and title', () => {
    expect(labels('opening-numbered-title')).toEqual([
      'Which would you choose?',
      '1: Pine house',
      '2: Glass cabin',
    ]);
  });

  it('infers opening-numbered from a saved template plus opening line', () => {
    expect(inferOverlayStructure({
      template: '{index}',
      firstTemplate: 'Which treehouse would you choose?',
    })).toBe('opening-numbered');
  });

  it('infers numbered-title from the retired number-and-title template', () => {
    expect(inferOverlayStructure({ template: '{index}. {title}' })).toBe('numbered-title');
  });
});
