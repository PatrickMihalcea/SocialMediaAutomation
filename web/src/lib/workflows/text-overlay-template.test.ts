import { describe, expect, it } from 'vitest';
import { renderTextOverlayLabels } from '@/lib/workflows/text-overlay-template';

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
      '{index}. {title}',
      null,
      [{ index: 0, title: null }],
    )).toEqual(['1.']);
  });
});
