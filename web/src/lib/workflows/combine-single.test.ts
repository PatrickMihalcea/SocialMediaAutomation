import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { parseConfig } from '@/lib/workflows/definitions';
import { checkAddedEdge } from '@/lib/workflows/port-resolution';

const node = (id: string, type: string) => ({ id, type, config: parseConfig(type, {}) });

/**
 * "First selected" is one item, and a Combine slot takes a list — so appending
 * a single chosen clip meant inserting a step whose only job was to make a list
 * of one. The slot accepts a single now; the kinds are still checked.
 */
describe('a single media into a combine slot', () => {
  const nodes = [node('lib', 'MEDIA_LIBRARY'), node('pick', 'PICK'), node('mix', 'COMBINE_MEDIA')];

  function withPickFedBy(port: string) {
    return [{ sourceNodeId: 'lib', sourcePort: port, targetNodeId: 'pick', targetPort: 'items' }];
  }

  it('accepts First selected when the picker holds images', () => {
    expect(checkAddedEdge({ nodes, edges: withPickFedBy('images') }, {
      sourceNodeId: 'pick', sourcePort: 'item', targetNodeId: 'mix', targetPort: 'media1',
    })).toBeNull();
  });

  it('accepts it when the picker holds videos', () => {
    expect(checkAddedEdge({ nodes, edges: withPickFedBy('videos') }, {
      sourceNodeId: 'pick', sourcePort: 'item', targetNodeId: 'mix', targetPort: 'media3',
    })).toBeNull();
  });

  /** The kind rule is untouched: a track is still not an image or a video. */
  it('still refuses a single audio track', () => {
    expect(checkAddedEdge({ nodes, edges: withPickFedBy('audio') }, {
      sourceNodeId: 'pick', sourcePort: 'item', targetNodeId: 'mix', targetPort: 'media1',
    })).toEqual({ reason: 'This input takes image or video, and that output can produce audio.' });
  });

  /** Everywhere else stays strict — a one-frame slideshow is still refused. */
  it('does not loosen other list inputs', () => {
    const slide = [node('lib', 'MEDIA_LIBRARY'), node('pick', 'PICK'), node('slide', 'BEAT_SLIDESHOW')];
    expect(checkAddedEdge({ nodes: slide, edges: withPickFedBy('images') }, {
      sourceNodeId: 'pick', sourcePort: 'item', targetNodeId: 'slide', targetPort: 'images',
    })).toEqual({ reason: 'That output is a single media and this input takes a list of them.' });
  });
});
