import { describe, expect, it } from 'vitest';
import { renderTextOverlayLabels } from '@/lib/workflows/text-overlay-template';

describe('text overlay templates', () => {
  it('uses opening copy once and numbers the following choices from one', () => {
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

  it('preserves the existing absolute index and title variables', () => {
    expect(renderTextOverlayLabels(
      '{index}. {title}',
      null,
      [{ index: 0, title: 'Canopy house' }],
    )).toEqual(['1. Canopy house']);
  });
});
