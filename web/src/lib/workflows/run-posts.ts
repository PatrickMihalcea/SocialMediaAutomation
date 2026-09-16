import 'server-only';
import { PostStatus } from '@prisma/client';
import { db } from '@/lib/db';

export interface RunPost {
  id: string;
  /** True while the post still needs a person to say yes. */
  awaitingApproval: boolean;
  /** "now" | "queue" | null — what approving it will actually set in motion. */
  releaseOnApproval: string | null;
}

/**
 * The posts a run's steps created, keyed by node run id.
 *
 * Read from the posts table rather than from the frozen node output, which is
 * what the run view used to do. Output is a snapshot of the instant the step
 * finished, so a post approved ten minutes later still read "Waiting for you"
 * on the run view forever. This reflects the post as it is now.
 *
 * Node output is still consulted for the post id, because posts created before
 * origin tracking existed carry no workflowNodeRunId to find them by.
 */
export async function postsForRun(
  workspaceId: string,
  nodeRuns: { id: string; output: unknown }[],
): Promise<Map<string, RunPost>> {
  const byNodeRun = new Map<string, string>();
  for (const node of nodeRuns) {
    const id = postIdFrom(node.output);
    if (id) byNodeRun.set(node.id, id);
  }
  const nodeRunIds = nodeRuns.map((node) => node.id);
  const postIds = [...byNodeRun.values()];
  if (!postIds.length && !nodeRunIds.length) return new Map();

  const posts = await db.post.findMany({
    where: {
      workspaceId,
      OR: [{ id: { in: postIds } }, { workflowNodeRunId: { in: nodeRunIds } }],
    },
    select: { id: true, status: true, releaseOnApproval: true, workflowNodeRunId: true },
  });

  const shape = (post: (typeof posts)[number]): RunPost => ({
    id: post.id,
    awaitingApproval: post.status === PostStatus.PENDING_APPROVAL,
    releaseOnApproval: post.releaseOnApproval,
  });

  const byId = new Map(posts.map((post) => [post.id, post]));
  const result = new Map<string, RunPost>();
  // The FK first: it is the authoritative link. The output id is the fallback
  // for runs that predate it.
  for (const post of posts) {
    if (post.workflowNodeRunId) result.set(post.workflowNodeRunId, shape(post));
  }
  for (const [nodeRunId, postId] of byNodeRun) {
    if (result.has(nodeRunId)) continue;
    const post = byId.get(postId);
    if (post) result.set(nodeRunId, shape(post));
  }
  return result;
}

/** The post id a draft or publish step recorded, when it recorded one. */
export function postIdFrom(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  const post = (output as { post?: unknown }).post;
  if (!post || typeof post !== 'object') return null;
  const id = (post as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}
