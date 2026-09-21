import { describe, expect, it } from 'vitest';
import { applyRideAlongs } from '@/lib/workflows/ride-alongs';

const IDEA = 'idea-node';
const MEDIA = 'media-node';

/** One edge into the step being resolved. */
const edge = (targetPort: string, sourcePort: string, sourceNodeId = IDEA) =>
  ({ targetPort, sourcePort, sourceNodeId });

function upstream(output: Record<string, unknown>, nodeId = IDEA) {
  return new Map([[nodeId, { output }]]);
}

describe('applyRideAlongs', () => {
  /**
   * The case this exists for. A sketch belongs to the theme the run drew, so
   * the step consuming that run's prompts is the only step that ever wants it —
   * and a second connection nobody knew to make produced a graph that looked
   * complete and generated without the layout.
   */
  it('carries a layout reference along with the prompts', () => {
    const inputs: Record<string, unknown> = { prompts: ['a villa'] };

    applyRideAlongs(
      [edge('prompts', 'prompts')],
      upstream({ prompts: ['a villa'], reference: 'asset-1' }),
      inputs,
    );

    expect(inputs.reference).toBe('asset-1');
  });

  it('carries the titles along too, so files are not named image-1', () => {
    const inputs: Record<string, unknown> = { prompts: ['a villa'] };

    applyRideAlongs(
      [edge('prompts', 'prompts')],
      upstream({ prompts: ['a villa'], titles: ['Cliffside villa'] }),
      inputs,
    );

    expect(inputs.titles).toEqual(['Cliffside villa']);
  });

  it('carries titles from the images that were generated, for the cut labels', () => {
    const inputs: Record<string, unknown> = { images: ['asset-1', 'asset-2'] };

    applyRideAlongs(
      [edge('images', 'images')],
      upstream({ images: ['asset-1', 'asset-2'], titles: ['One', 'Two'] }),
      inputs,
    );

    expect(inputs.titles).toEqual(['One', 'Two']);
  });

  /**
   * Titles can still be wired from elsewhere, and somebody who did that meant
   * those. (A reference cannot: the Image generator has no port for one, so it
   * only ever arrives with the prompts.)
   */
  it('leaves an explicitly wired value alone', () => {
    const inputs: Record<string, unknown> = { prompts: ['a villa'], titles: ['Named by hand'] };

    applyRideAlongs(
      [edge('prompts', 'prompts'), edge('titles', 'titles', MEDIA)],
      upstream({ prompts: ['a villa'], titles: ['Named by the idea step'] }),
      inputs,
    );

    expect(inputs.titles).toEqual(['Named by hand']);
  });

  it('adds nothing when the carrying port is not connected', () => {
    const inputs: Record<string, unknown> = { titles: ['Typed'] };

    applyRideAlongs([edge('titles', 'titles')], upstream({ reference: 'asset-1' }), inputs);

    expect(inputs.reference).toBeUndefined();
  });

  /**
   * The failure this caused in a live run. The Media library names its images,
   * so a track picker wired to its audio received titles: [] — read downstream
   * as "labels supplied, zero of them" against one track, and refused.
   */
  it('does not carry an empty list, which reads as zero rather than none', () => {
    const inputs: Record<string, unknown> = { items: ['track-1'] };

    applyRideAlongs([edge('items', 'images')], upstream({ audio: ['track-1'], titles: [] }), inputs);

    expect(inputs.titles).toBeUndefined();
  });

  it('adds nothing when the upstream step produced none', () => {
    const inputs: Record<string, unknown> = { prompts: ['a villa'] };

    applyRideAlongs([edge('prompts', 'prompts')], upstream({ prompts: ['a villa'], reference: null }), inputs);

    expect(inputs.reference).toBeUndefined();
    expect(inputs.titles).toBeUndefined();
  });

  it('takes the value from the step that carried it, not from any other', () => {
    const inputs: Record<string, unknown> = { prompts: ['a villa'] };
    const nodes = new Map([
      [IDEA, { output: { prompts: ['a villa'], reference: 'from-the-idea-step' } }],
      [MEDIA, { output: { reference: 'from-somewhere-else' } }],
    ]);

    applyRideAlongs([edge('prompts', 'prompts'), edge('audio', 'audio', MEDIA)], nodes, inputs);

    expect(inputs.reference).toBe('from-the-idea-step');
  });
});

/**
 * The failure this caused in a live run. The Media library emits one titles
 * list, describing its images — so a track picker fed from its audio output was
 * handed the names of thirty-four pictures and refused the count against a
 * handful of tracks. What the edge carried has to decide what rides with it.
 */
describe('titles only ride with the list they describe', () => {
  const library = new Map([[MEDIA, {
    output: { images: ['a', 'b'], audio: ['track-1'], titles: ['Attic', 'Garden'] },
  }]]);

  it('does not attach image titles to an audio list', () => {
    const inputs: Record<string, unknown> = { items: ['track-1'] };

    applyRideAlongs([edge('items', 'audio', MEDIA)], library, inputs);

    expect(inputs.titles).toBeUndefined();
  });

  it('attaches them to an image list from the same step', () => {
    const inputs: Record<string, unknown> = { items: ['a', 'b'] };

    applyRideAlongs([edge('items', 'images', MEDIA)], library, inputs);

    expect(inputs.titles).toEqual(['Attic', 'Garden']);
  });

  it('does not attach them to a video list either', () => {
    const inputs: Record<string, unknown> = { items: ['clip-1'] };

    applyRideAlongs([edge('items', 'videos', MEDIA)], library, inputs);

    expect(inputs.titles).toBeUndefined();
  });
});

/**
 * The failure this caused in a live run. Pick one names every item it selected,
 * so sending "First selected" into a Combine media slot alongside the whole
 * selection handed one picture the names of all eight — and Combine media
 * refused, because a title list that does not line up puts every label on the
 * wrong frame.
 */
describe('one item carries one title', () => {
  const picked = new Map([[IDEA, {
    output: {
      item: 'asset-1',
      selection: ['asset-1', 'asset-2', 'asset-3'],
      itemTitle: ['Cliffside'],
      titles: ['Cliffside', 'Canopy', 'Desert'],
    },
  }]]);

  it('gives a slot fed by First selected only that item’s title', () => {
    const inputs: Record<string, unknown> = { media2: 'asset-1' };

    applyRideAlongs([edge('media2', 'item')], picked, inputs);

    expect(inputs.titles2).toEqual(['Cliffside']);
  });

  it('still gives a slot fed by the selection the whole list', () => {
    const inputs: Record<string, unknown> = { media1: ['asset-1', 'asset-2', 'asset-3'] };

    applyRideAlongs([edge('media1', 'selection')], picked, inputs);

    expect(inputs.titles1).toEqual(['Cliffside', 'Canopy', 'Desert']);
  });

  /**
   * A step that already succeeded keeps the output it recorded, so resuming a
   * run started before `itemTitle` existed has only the list to work from. The
   * first title is the one belonging to `item`, so the frame is still labelled
   * correctly rather than left blank.
   */
  it('falls back to the first title for an output recorded before the fix', () => {
    const inputs: Record<string, unknown> = { media2: 'asset-1' };

    applyRideAlongs(
      [edge('media2', 'item')],
      upstream({
        item: 'asset-1',
        selection: ['asset-1', 'asset-2'],
        titles: ['Cliffside', 'Canopy'],
      }),
      inputs,
    );

    expect(inputs.titles2).toEqual(['Cliffside']);
  });

  it('carries nothing when the picked items were never named', () => {
    const inputs: Record<string, unknown> = { media2: 'track-1' };

    applyRideAlongs(
      [edge('media2', 'item')],
      upstream({ item: 'track-1', itemTitle: [], titles: [] }),
      inputs,
    );

    expect(inputs.titles2).toBeUndefined();
  });
});
