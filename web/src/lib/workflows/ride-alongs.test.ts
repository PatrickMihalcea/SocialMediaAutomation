import { describe, expect, it } from 'vitest';
import { applyRideAlongs } from '@/lib/workflows/ride-alongs';

const IDEA = 'idea-node';
const MEDIA = 'media-node';

/** One edge into the step being resolved. */
const edge = (targetPort: string, sourceNodeId = IDEA) => ({ targetPort, sourceNodeId });

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
      [edge('prompts')],
      upstream({ prompts: ['a villa'], reference: 'asset-1' }),
      inputs,
    );

    expect(inputs.reference).toBe('asset-1');
  });

  it('carries the titles along too, so files are not named image-1', () => {
    const inputs: Record<string, unknown> = { prompts: ['a villa'] };

    applyRideAlongs(
      [edge('prompts')],
      upstream({ prompts: ['a villa'], titles: ['Cliffside villa'] }),
      inputs,
    );

    expect(inputs.titles).toEqual(['Cliffside villa']);
  });

  it('carries titles from the images that were generated, for the cut labels', () => {
    const inputs: Record<string, unknown> = { images: ['asset-1', 'asset-2'] };

    applyRideAlongs(
      [edge('images')],
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
      [edge('prompts'), edge('titles', MEDIA)],
      upstream({ prompts: ['a villa'], titles: ['Named by the idea step'] }),
      inputs,
    );

    expect(inputs.titles).toEqual(['Named by hand']);
  });

  it('adds nothing when the carrying port is not connected', () => {
    const inputs: Record<string, unknown> = { titles: ['Typed'] };

    applyRideAlongs([edge('titles')], upstream({ reference: 'asset-1' }), inputs);

    expect(inputs.reference).toBeUndefined();
  });

  it('adds nothing when the upstream step produced none', () => {
    const inputs: Record<string, unknown> = { prompts: ['a villa'] };

    applyRideAlongs([edge('prompts')], upstream({ prompts: ['a villa'], reference: null }), inputs);

    expect(inputs.reference).toBeUndefined();
    expect(inputs.titles).toBeUndefined();
  });

  it('takes the value from the step that carried it, not from any other', () => {
    const inputs: Record<string, unknown> = { prompts: ['a villa'] };
    const nodes = new Map([
      [IDEA, { output: { prompts: ['a villa'], reference: 'from-the-idea-step' } }],
      [MEDIA, { output: { reference: 'from-somewhere-else' } }],
    ]);

    applyRideAlongs([edge('prompts'), edge('audio', MEDIA)], nodes, inputs);

    expect(inputs.reference).toBe('from-the-idea-step');
  });
});
