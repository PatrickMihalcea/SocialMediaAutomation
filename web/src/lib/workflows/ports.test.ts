import { describe, expect, it } from 'vitest';
import { MediaType } from '@prisma/client';
import { checkCompatible, isCompatible, json, media, post, text } from '@/lib/workflows/ports';

describe('checkCompatible', () => {
  it('accepts a matching scalar and arity', () => {
    expect(isCompatible(text(true), text(true))).toBe(true);
    expect(isCompatible(media([MediaType.VIDEO]), media([MediaType.VIDEO]))).toBe(true);
  });

  it('rejects a scalar mismatch', () => {
    expect(isCompatible(text(), post())).toBe(false);
  });

  it('refuses to silently collect a single value into a list', () => {
    // Implicit widening would make the run graph lie about its own arity.
    const problem = checkCompatible(text(false), text(true));
    expect(problem?.reason).toContain('Collect');
  });

  it('refuses to silently pick one item out of a list', () => {
    const problem = checkCompatible(media([MediaType.IMAGE], true), media([MediaType.IMAGE], false));
    expect(problem?.reason).toContain('Pick');
  });

  it('stops an image list being dropped onto an audio input', () => {
    // The mistake this whole type system exists to catch.
    const problem = checkCompatible(
      media([MediaType.IMAGE], true),
      media([MediaType.AUDIO], true),
    );
    expect(problem).not.toBeNull();
    expect(problem?.reason).toContain('audio');
  });

  it('allows a narrower media source into a wider input', () => {
    const pick = media([MediaType.IMAGE, MediaType.VIDEO, MediaType.AUDIO]);
    expect(isCompatible(media([MediaType.VIDEO]), pick)).toBe(true);
  });

  it('does not treat json as a wildcard', () => {
    // A json source landing in a text[] input is a bug you lose an afternoon to.
    expect(isCompatible(json(), text(true))).toBe(false);
    expect(isCompatible(text(true), json())).toBe(false);
  });

  it('checks a named json shape nominally', () => {
    expect(isCompatible(json('beat-segments'), json('beat-segments'))).toBe(true);
    expect(isCompatible(json('other'), json('beat-segments'))).toBe(false);
    // A target with no declared shape still accepts anything json.
    expect(isCompatible(json('beat-segments'), json())).toBe(true);
  });

  it('names both sides in the message it shows the user', () => {
    const problem = checkCompatible(text(), media([MediaType.VIDEO]));
    expect(problem?.reason).toContain('text');
    expect(problem?.reason).toContain('video');
  });
});
