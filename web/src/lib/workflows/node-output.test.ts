import { describe, expect, it } from 'vitest';
import { hasReviewableOutput, reviewableOutput } from '@/lib/workflows/node-output';

const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const OTHER = '9c858901-8a57-4791-81fe-4c455b099bc9';

describe('reviewableOutput', () => {
  /**
   * The complaint this exists for: a Save draft step offered "see what it made"
   * and showed the draft's uuid, next to an "Open the post" link that was
   * already the useful version of the same thing.
   */
  it('finds nothing to review in a step that only recorded a post reference', () => {
    expect(reviewableOutput({ post: { id: ID, status: 'DRAFT' } })).toBeNull();
    expect(hasReviewableOutput({ post: { id: ID, status: 'DRAFT' } })).toBe(false);
  });

  it('finds nothing in a step that only recorded asset ids', () => {
    expect(reviewableOutput({ images: [ID, OTHER] })).toBeNull();
    expect(reviewableOutput({ video: ID })).toBeNull();
  });

  it('keeps the text a step wrote, and drops the ids beside it', () => {
    expect(reviewableOutput({ images: [ID, OTHER], titles: ['Canopy house', 'Pine house'] }))
      .toEqual({ titles: ['Canopy house', 'Pine house'] });
  });

  it('keeps a measurement next to the asset it describes', () => {
    expect(reviewableOutput({ audio: ID, bpm: 128 })).toEqual({ bpm: 128 });
    expect(reviewableOutput({ video: ID, adjustment: 'halved-beats' }))
      .toEqual({ adjustment: 'halved-beats' });
  });

  it('keeps everything an idea step wrote', () => {
    const output = {
      theme: 'cliffside houses',
      postTitle: 'Six houses on the edge',
      caption: 'Some copy.',
      hashtags: '#architecture #design',
      prompts: ['A long prompt.'],
      titles: ['Glass ledge'],
    };
    expect(reviewableOutput(output)).toEqual(output);
  });

  it('drops empties, which read as broken rather than as absent', () => {
    expect(reviewableOutput({ caption: '', titles: [], theme: 'rooms' })).toEqual({ theme: 'rooms' });
  });

  it('keeps a zero, which is a measurement and not an absence', () => {
    expect(reviewableOutput({ audio: ID, bpm: 0 })).toEqual({ bpm: 0 });
  });

  it('is null for a step that recorded nothing at all', () => {
    expect(reviewableOutput(null)).toBeNull();
    expect(reviewableOutput({})).toBeNull();
    expect(reviewableOutput('a string')).toBeNull();
  });

  it('does not mistake ordinary text for a reference', () => {
    expect(reviewableOutput({ note: 'not-a-uuid', titles: ['a', 'b'] }))
      .toEqual({ note: 'not-a-uuid', titles: ['a', 'b'] });
  });
});
