import { describe, expect, it } from 'vitest';
import { describeConnection } from '@/lib/workflows/connection-label';

const nodes = new Map([
  ['node-images', { name: 'Images', type: 'IMAGE_GENERATOR' }],
  ['node-slideshow', { name: 'Slideshow', type: 'BEAT_SLIDESHOW' }],
]);

describe('describeConnection', () => {
  it('uses step names and port labels from the node catalogue', () => {
    const result = describeConnection(
      {
        sourceNodeId: 'node-images',
        sourcePort: 'images',
        targetNodeId: 'node-slideshow',
        targetPort: 'images',
      },
      nodes,
    );
    expect(result.title).toBe('Images · Images → Slideshow · Media');
    expect(result.ariaLabel).toBe('Connection from Images Images to Slideshow Media');
    expect(result.source.nodeName).toBe('Images');
    expect(result.target.nodeName).toBe('Slideshow');
  });

  it('falls back to port ids when the step type is unknown', () => {
    const result = describeConnection(
      {
        sourceNodeId: 'node-images',
        sourcePort: 'custom-out',
        targetNodeId: 'missing-node',
        targetPort: 'custom-in',
      },
      nodes,
    );
    expect(result.source.portId).toBe('custom-out');
    expect(result.target.nodeName).toBe('missing-');
    expect(result.target.portId).toBe('custom-in');
  });
});
