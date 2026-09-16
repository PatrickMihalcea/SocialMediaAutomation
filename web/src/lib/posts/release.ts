import 'server-only';
import { PostStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { addToQueue } from '@/lib/scheduling/queue';
import { invalid } from '@/lib/errors';

/**
 * How a post leaves the workspace once nothing is holding it back.
 *
 * "now" publishes immediately; "queue" takes the next open posting slot. These
 * are the two modes a workflow's publish step offers, and they are recorded on
 * the post so an approval pause does not discard the choice.
 */
export type ReleaseMode = 'now' | 'queue';

export function isReleaseMode(value: unknown): value is ReleaseMode {
  return value === 'now' || value === 'queue';
}

/**
 * Sends a post on its way, by the mode it was configured with.
 *
 * Both the workflow publish step and the approval screen call this, which is
 * the point: before it existed, approving a post set it APPROVED and stopped,
 * while nothing in the publishing engine ever looks at APPROVED — so an
 * approved post silently never published. One function means the two entry
 * points cannot drift apart again.
 *
 * Returns the instant the post is now expected to go out.
 */
export async function releasePost(
  workspaceId: string,
  postId: string,
  mode: ReleaseMode,
): Promise<Date> {
  if (mode === 'queue') {
    const workspace = await db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { queuePaused: true },
    });
    if (workspace.queuePaused) {
      throw invalid('The queue is paused, so this post was not scheduled. Resume it in Queue settings.');
    }
    return addToQueue(workspaceId, postId);
  }

  const at = new Date();
  // Routed through the scheduler rather than published inline: the publishing
  // engine owns retries, per-channel state and the failed-jobs view, and a
  // direct call here would have none of it.
  const updated = await db.post.updateMany({
    where: {
      id: postId,
      workspaceId,
      status: { notIn: [PostStatus.PUBLISHED, PostStatus.PUBLISHING] },
    },
    data: { status: PostStatus.SCHEDULED, scheduledAt: at },
  });
  if (updated.count !== 1) {
    throw invalid('This post is already publishing, so it was left alone.');
  }
  await enqueue('publish-post', { postId }, { workspaceId, dedupeKey: `publish:${postId}` });
  return at;
}
