import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveOrderedAssets } from '@/lib/workflows/nodes/beat-slideshow';

const asset = (id: string) => ({ id, filename: `${id}.png` });

describe('resolveOrderedAssets', () => {
  it('returns the assets in the order they were requested', () => {
    const found = [asset('b'), asset('a'), asset('c')];

    expect(resolveOrderedAssets(['a', 'b', 'c'], found).map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });

  /**
   * The regression this exists for. A merge step upstream produced six entries
   * with one image repeated, every one of them present in the library — but the
   * old check compared list length against the row count findMany returns, which
   * only ever has one row per distinct id. Five never equals six, so a run whose
   * media was entirely intact failed with "no longer in the media library".
   */
  it('accepts a repeated id without treating it as missing', () => {
    const ids = ['img5', 'img1', 'img2', 'img3', 'img4', 'img5'];
    const found = ['img1', 'img2', 'img3', 'img4', 'img5'].map(asset);

    const ordered = resolveOrderedAssets(ids, found);

    expect(ordered).toHaveLength(6);
    expect(ordered.map((a) => a.id)).toEqual(ids);
    // The repeat is preserved rather than collapsed — using the same shot twice
    // is the edit the user configured, not a duplicate to clean up.
    expect(ordered[0].id).toBe('img5');
    expect(ordered[5].id).toBe('img5');
  });

  it('still refuses when an id genuinely has no row', () => {
    const found = [asset('a'), asset('c')];

    expect(() => resolveOrderedAssets(['a', 'b', 'c'], found)).toThrow(/no longer in the media library/);
  });

  // A row the workspace-scoped query filtered out (another tenant's asset, or
  // the wrong media type) arrives here as simply absent, and must still fail.
  it('refuses when the query returned nothing at all', () => {
    expect(() => resolveOrderedAssets(['a'], [])).toThrow(/no longer in the media library/);
  });
});
