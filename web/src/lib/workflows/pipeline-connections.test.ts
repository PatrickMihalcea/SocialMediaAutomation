import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { getDefinition, parseConfig } from '@/lib/workflows/definitions';
import { checkAddedEdge } from '@/lib/workflows/port-resolution';

const node = (id: string, type: string) => ({ id, type, config: parseConfig(type, {}) });

/** [feeder into the generic step | null, source.port, target.port] */
const MUST_WORK: Array<[string | null, string, string]> = [
  // Ideas into images, and the copy into a post.
  [null, 'IDEA_GENERATOR.prompts', 'IMAGE_GENERATOR.prompts'],
  [null, 'IDEA_GENERATOR.postTitle', 'CREATE_DRAFT.title'],
  [null, 'IDEA_GENERATOR.caption', 'CREATE_DRAFT.caption'],
  [null, 'IDEA_GENERATOR.hashtags', 'CREATE_DRAFT.hashtags'],
  [null, 'IDEA_GENERATOR.postTitle', 'PUBLISH.title'],
  [null, 'IDEA_GENERATOR.caption', 'PUBLISH.caption'],
  [null, 'IDEA_GENERATOR.hashtags', 'PUBLISH.hashtags'],
  [null, 'IDEA_GENERATOR.postTitle', 'TEXT_OVERLAY.firstTemplate'],
  [null, 'IDEA_GENERATOR.theme', 'IDEA_GENERATOR.theme'],
  // Images onward.
  [null, 'IMAGE_GENERATOR.images', 'BEAT_SLIDESHOW.images'],
  [null, 'IMAGE_GENERATOR.images', 'COMBINE_MEDIA.media1'],
  [null, 'IMAGE_GENERATOR.images', 'COMBINE_MEDIA.media4'],
  [null, 'IMAGE_GENERATOR.images', 'PICK.items'],
  [null, 'IMAGE_GENERATOR.images', 'ANIMATE_IMAGE.images'],
  // The library feeds selection.
  [null, 'MEDIA_LIBRARY.images', 'PICK.items'],
  [null, 'MEDIA_LIBRARY.videos', 'PICK.items'],
  [null, 'MEDIA_LIBRARY.audio', 'PICK.items'],
  [null, 'MEDIA_LIBRARY.images', 'BEAT_SLIDESHOW.images'],
  [null, 'MEDIA_LIBRARY.images', 'COMBINE_MEDIA.media1'],
  // Selection onward — the case that prompted this.
  ['MEDIA_LIBRARY.images', 'PICK.selection', 'COMBINE_MEDIA.media1'],
  ['MEDIA_LIBRARY.images', 'PICK.selection', 'BEAT_SLIDESHOW.images'],
  ['MEDIA_LIBRARY.images', 'PICK.selection', 'ANIMATE_IMAGE.images'],
  ['IMAGE_GENERATOR.images', 'PICK.selection', 'COMBINE_MEDIA.media2'],
  ['MEDIA_LIBRARY.audio', 'PICK.item', 'BEAT_SLIDESHOW.audio'],
  ['MEDIA_LIBRARY.audio', 'PICK.item', 'AUDIO_TRIMMER.audio'],
  ['MEDIA_LIBRARY.videos', 'PICK.item', 'TEXT_OVERLAY.video'],
  ['MEDIA_LIBRARY.videos', 'PICK.item', 'CREATE_DRAFT.video'],
  ['MEDIA_LIBRARY.videos', 'PICK.item', 'PUBLISH.video'],
  // Combining and cutting.
  [null, 'BEAT_SLIDESHOW.video', 'TEXT_OVERLAY.video'],
  [null, 'BEAT_SLIDESHOW.video', 'CREATE_DRAFT.video'],
  [null, 'BEAT_SLIDESHOW.video', 'PUBLISH.video'],
  [null, 'TEXT_OVERLAY.video', 'CREATE_DRAFT.video'],
  [null, 'TEXT_OVERLAY.video', 'PUBLISH.video'],
  [null, 'TEXT_OVERLAY.video', 'AUDIO_TRIMMER.audio'],
];

/**
 * Chains, for the steps a single hop cannot reach: the library emits lists and
 * a trimmer takes one item, so a picker has to sit between them. Built one edge
 * at a time, because a generic step only resolves once its input is connected.
 */
describe('chains a real pipeline needs', () => {
  const CHAINS: Array<{ name: string; steps: Array<[string, string]>; hops: Array<[string, string, string, string]> }> = [
    {
      name: 'a combine of stills into a slideshow and a picker',
      steps: [['lib', 'MEDIA_LIBRARY'], ['mix', 'COMBINE_MEDIA'], ['slide', 'BEAT_SLIDESHOW'], ['pick', 'PICK']],
      hops: [
        ['lib', 'images', 'mix', 'media1'],
        ['mix', 'media', 'slide', 'images'],
        ['mix', 'media', 'pick', 'items'],
      ],
    },
    {
      name: 'library to a trimmed track to a slideshow',
      steps: [['lib', 'MEDIA_LIBRARY'], ['pick', 'PICK'], ['trim', 'AUDIO_TRIMMER'], ['slide', 'BEAT_SLIDESHOW']],
      hops: [
        ['lib', 'audio', 'pick', 'items'],
        ['pick', 'item', 'trim', 'audio'],
        ['trim', 'audio', 'slide', 'audio'],
      ],
    },
    {
      name: 'library video to a trimmer to an overlay',
      steps: [['lib', 'MEDIA_LIBRARY'], ['pick', 'PICK'], ['trim', 'AUDIO_TRIMMER'], ['text', 'TEXT_OVERLAY']],
      hops: [
        ['lib', 'videos', 'pick', 'items'],
        ['pick', 'item', 'trim', 'audio'],
        ['trim', 'audio', 'text', 'video'],
      ],
    },
    {
      name: 'generated stills, combined, cut and labelled twice',
      steps: [
        ['idea', 'IDEA_GENERATOR'], ['img', 'IMAGE_GENERATOR'], ['mix', 'COMBINE_MEDIA'],
        ['music', 'MUSIC_SELECTOR'], ['slide', 'BEAT_SLIDESHOW'],
        ['t1', 'TEXT_OVERLAY'], ['t2', 'TEXT_OVERLAY'], ['draft', 'CREATE_DRAFT'],
      ],
      hops: [
        ['idea', 'prompts', 'img', 'prompts'],
        ['img', 'images', 'mix', 'media1'],
        ['mix', 'media', 'slide', 'images'],
        ['music', 'audio', 'slide', 'audio'],
        ['slide', 'video', 't1', 'video'],
        ['t1', 'video', 't2', 'video'],
        ['t2', 'video', 'draft', 'video'],
      ],
    },
  ];

  for (const chain of CHAINS) {
    it(chain.name, () => {
      const nodes = chain.steps.map(([id, type]) => node(id, type));
      const edges: Array<{ sourceNodeId: string; sourcePort: string; targetNodeId: string; targetPort: string }> = [];
      for (const [sourceNodeId, sourcePort, targetNodeId, targetPort] of chain.hops) {
        const candidate = { sourceNodeId, sourcePort, targetNodeId, targetPort };
        expect(checkAddedEdge({ nodes, edges }, candidate), `${sourceNodeId}.${sourcePort} -> ${targetNodeId}.${targetPort}`).toBeNull();
        edges.push(candidate);
      }
    });
  }
});

describe('every connection a real pipeline needs', () => {
  for (const [feeder, from, to] of MUST_WORK) {
    it(`${from} -> ${to}${feeder ? ` (fed by ${feeder})` : ''}`, () => {
      const [sourceType, sourcePort] = from.split('.');
      const [targetType, targetPort] = to.split('.');
      const nodes = [node('s', sourceType), node('t', targetType)];
      const edges: Array<{ sourceNodeId: string; sourcePort: string; targetNodeId: string; targetPort: string }> = [];

      if (feeder) {
        const [ft, fp] = feeder.split('.');
        const followed = getDefinition(sourceType)!.outputs.find((p) => p.followsInput)?.followsInput;
        nodes.push(node('f', ft));
        edges.push({ sourceNodeId: 'f', sourcePort: fp, targetNodeId: 's', targetPort: followed! });
      }
      if (sourceType === targetType) nodes[1] = node('t', targetType);

      expect(checkAddedEdge({ nodes, edges }, {
        sourceNodeId: 's', sourcePort, targetNodeId: 't', targetPort,
      })).toBeNull();
    });
  }
});
