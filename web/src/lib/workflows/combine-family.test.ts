import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { parseConfig } from '@/lib/workflows/definitions';
import { checkAddedEdge, resolveOutputType } from '@/lib/workflows/port-resolution';

const node = (id: string, type: string) => ({ id, type, config: parseConfig(type, {}) });

/**
 * Combine media appends its slots into one list, so the list has to be of one
 * kind — two tracks concatenated with three stills is something no later step
 * can use. The first connection settles which family the step is combining.
 */
describe('a combine step holds every slot to one family', () => {
  const nodes = [node('lib', 'MEDIA_LIBRARY'), node('mix', 'COMBINE_MEDIA'), node('slide', 'BEAT_SLIDESHOW')];
  const from = (port: string, slot: string) =>
    ({ sourceNodeId: 'lib', sourcePort: port, targetNodeId: 'mix', targetPort: slot });

  it('accepts audio when nothing else is connected', () => {
    expect(checkAddedEdge({ nodes, edges: [] }, from('audio', 'media1'))).toBeNull();
  });

  it('accepts images when nothing else is connected', () => {
    expect(checkAddedEdge({ nodes, edges: [] }, from('images', 'media1'))).toBeNull();
  });

  it('refuses stills once it is combining audio', () => {
    expect(checkAddedEdge({ nodes, edges: [from('audio', 'media1')] }, from('images', 'media2')))
      .toEqual({ reason: 'This step is already combining audio, so every input has to be audio.' });
  });

  it('refuses audio once it is combining stills', () => {
    expect(checkAddedEdge({ nodes, edges: [from('images', 'media1')] }, from('audio', 'media2')))
      .toEqual({ reason: 'This step is already combining images or video, so every input has to be an image or a video.' });
  });

  it('allows more of the same family', () => {
    expect(checkAddedEdge({ nodes, edges: [from('audio', 'media1')] }, from('audio', 'media3'))).toBeNull();
    expect(checkAddedEdge({ nodes, edges: [from('images', 'media1')] }, from('videos', 'media2'))).toBeNull();
  });

  it('emits what it was given, so a visual combine still feeds a slideshow', () => {
    const edges = [from('images', 'media1')];
    const out = resolveOutputType({ nodes, edges }, 'mix', 'media');
    expect(out.state).toBe('type');
    expect(checkAddedEdge({ nodes, edges }, {
      sourceNodeId: 'mix', sourcePort: 'media', targetNodeId: 'slide', targetPort: 'images',
    })).toBeNull();
  });

  it('and an audio combine is refused by a slideshow, which shows pictures', () => {
    const edges = [from('audio', 'media1')];
    expect(checkAddedEdge({ nodes, edges }, {
      sourceNodeId: 'mix', sourcePort: 'media', targetNodeId: 'slide', targetPort: 'images',
    })).not.toBeNull();
  });
});
