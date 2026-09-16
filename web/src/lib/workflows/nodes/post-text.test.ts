import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { postText, postTitle } from '@/lib/workflows/nodes/post-text';
import type { NodeRunContext } from '@/lib/workflows/node-context';

const ctx = (inputs: Record<string, unknown>) => ({ inputs } as unknown as NodeRunContext);

const typed = {
  caption: 'Typed caption',
  hashtags: '#typed',
  mentions: '@typed',
  firstComment: 'Typed comment',
  link: 'https://typed.example',
};

describe('postText', () => {
  it('falls back to what was typed into the step', () => {
    expect(postText(ctx({}), typed)).toEqual({
      text: 'Typed caption',
      hashtags: ['typed'],
      mentions: ['typed'],
      firstComment: 'Typed comment',
      link: 'https://typed.example',
    });
  });

  it('prefers a connected value over a typed one', () => {
    const resolved = postText(ctx({
      caption: 'Written upstream',
      hashtags: '#generated, #brief',
      firstComment: 'Generated comment',
    }), typed);

    expect(resolved).toEqual({
      text: 'Written upstream',
      hashtags: ['generated', 'brief'],
      mentions: ['typed'],
      firstComment: 'Generated comment',
      link: 'https://typed.example',
    });
  });

  // These two have no ports, so a value arriving under those keys is not a
  // connection and must not be allowed to act like one.
  it('ignores mentions and links arriving as inputs', () => {
    const resolved = postText(
      ctx({ mentions: '@upstream', link: 'https://upstream.example' }),
      typed,
    );
    expect(resolved.mentions).toEqual(['typed']);
    expect(resolved.link).toBe('https://typed.example');
  });

  // A step upstream that produced nothing must not blank a caption the user
  // typed as the fallback — that is what makes the typed value a default
  // rather than dead weight.
  it('treats a blank or absent connected value as unset', () => {
    expect(postText(ctx({ caption: '   ', hashtags: '' }), typed).text).toBe('Typed caption');
    expect(postText(ctx({ caption: null, hashtags: undefined }), typed).hashtags).toEqual(['typed']);
  });

  it('parses tags the way the composer does, with or without a sigil', () => {
    const resolved = postText(ctx({ hashtags: 'one #two, three' }), { ...typed, mentions: '@a b' });
    expect(resolved.hashtags).toEqual(['one', 'two', 'three']);
    expect(resolved.mentions).toEqual(['a', 'b']);
  });

  it('reports an empty optional field as null rather than an empty string', () => {
    const resolved = postText(ctx({}), { ...typed, firstComment: '', link: '' });
    expect(resolved.firstComment).toBeNull();
    expect(resolved.link).toBeNull();
  });
});

describe('postTitle', () => {
  it('prefers the connection over the typed title', () => {
    expect(postTitle(ctx({ title: 'From brief' }), 'Typed')).toBe('From brief');
    expect(postTitle(ctx({}), 'Typed')).toBe('Typed');
  });

  // The step's name is the user's label for a box on the canvas. Borrowing it
  // published posts titled "Publish to YouTube", so an unset title is now
  // untitled and the app lists the post by its opening copy instead.
  it('is null when no title was set, rather than borrowing the step name', () => {
    expect(postTitle(ctx({}), '')).toBeNull();
    expect(postTitle(ctx({ title: '  ' }), '   ')).toBeNull();
  });
});
