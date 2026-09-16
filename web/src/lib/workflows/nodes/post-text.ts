import 'server-only';
import { parseTagList } from '@/lib/posts/tags';
import { connectedText } from '@/lib/workflows/connected-text';
import type { NodeRunContext } from '@/lib/workflows/node-context';

export interface PostTextConfig {
  caption: string;
  hashtags: string;
  mentions: string;
  firstComment: string;
  link: string;
}

/** The written fields of a post, in the shape savePost takes. */
export interface PostText {
  text: string;
  hashtags: string[];
  mentions: string[];
  firstComment: string | null;
  link: string | null;
}

const connected = connectedText;

/**
 * Resolves each written field of a post to the connected value if there is
 * one, and to what was typed into the step otherwise.
 *
 * A connected port wins because it is the more specific instruction: someone
 * who wired a brief into the caption meant the brief to write it, and a typed
 * value left behind from before should not silently take precedence. Empty
 * counts as absent, so an unconnected port and an unfilled one behave alike —
 * which also means an upstream step that produced nothing leaves the typed
 * fallback standing rather than blanking the field.
 *
 * Mentions and links have no ports and read from config alone.
 *
 * Tags parse through the same helper the composer uses, so "#a, b" written in a
 * step becomes the same two tags it would from the composer.
 */
export function postText(ctx: NodeRunContext, config: PostTextConfig): PostText {
  const caption = connected(ctx.inputs.caption) || config.caption;
  const hashtags = connected(ctx.inputs.hashtags) || config.hashtags;
  const firstComment = connected(ctx.inputs.firstComment) || config.firstComment;

  return {
    text: caption,
    hashtags: parseTagList(hashtags, '#'),
    // Typed only, by design: a mention has to match a real account and a link
    // a real destination, and neither is something to let a brief guess at.
    mentions: parseTagList(config.mentions, '@'),
    firstComment: firstComment.trim() || null,
    link: config.link.trim() || null,
  };
}

/**
 * The post's title, which belongs to the post rather than to a channel.
 *
 * Null when nobody set one, rather than borrowing the step's name: that name
 * is how the user labels a box on the canvas, so falling back to it published
 * posts titled "Publish to YouTube". The app shows an untitled post by its
 * opening copy, which is a better guess than the step's label ever was.
 */
export function postTitle(ctx: NodeRunContext, typed: string): string | null {
  return connected(ctx.inputs.title) || typed.trim() || null;
}
