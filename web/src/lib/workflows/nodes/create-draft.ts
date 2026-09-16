import 'server-only';
import { PostStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { savePost } from '@/lib/posts/service';
import { PermanentJobError } from '@/lib/queue/runner';
import { postText, postTitle } from '@/lib/workflows/nodes/post-text';
import type { NodeRunContext } from '@/lib/workflows/node-context';

interface Config {
  title: string;
  caption: string;
  hashtags: string;
  mentions: string;
  firstComment: string;
  link: string;
  campaignId: string | null;
  socialAccountIds: string[];
}

/**
 * Hands the finished video to the composer as a draft.
 *
 * Goes through savePost rather than writing rows directly, so a workflow-created
 * post gets the same validation, idempotency keys and lifecycle rules as one a
 * person typed — a draft that the composer would reject must not be able to
 * arrive by the back door.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const videoId = typeof ctx.inputs.video === 'string' ? ctx.inputs.video : null;
  if (!videoId) throw new PermanentJobError('No video reached this step.');

  const accounts = await resolveAccounts(ctx.workspaceId, config.socialAccountIds);
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { timezone: true },
  });

  const post = await savePost(
    ctx.workspaceId,
    ctx.userId ?? accounts[0].workspaceOwnerId,
    {
      title: postTitle(ctx, config.title),
      campaignId: config.campaignId,
      timezone: workspace.timezone,
      status: PostStatus.DRAFT,
      scheduledAt: null,
      platforms: accounts.map((account) => ({
        socialAccountId: account.id,
        platform: account.platform,
        ...postText(ctx, config),
        media: [{ mediaAssetId: videoId }],
      })),
    },
    // Content validation is deferred to the draft screen: a draft is allowed to
    // be incomplete, and failing the whole run over a caption the user has not
    // written yet would throw away the render.
    { validateContent: false },
  );

  // Same origin stamp the publish step writes: a draft that appeared on its own
  // overnight should be able to say which run produced it.
  await db.post.update({
    where: { id: post.id },
    data: { workflowNodeRunId: ctx.nodeRunId },
  });

  return { post: { id: post.id, status: post.status } };
}

export async function resolveAccounts(workspaceId: string, ids: string[]) {
  const accounts = await db.socialAccount.findMany({
    where: {
      workspaceId,
      status: 'ACTIVE',
      ...(ids.length ? { id: { in: ids } } : {}),
    },
    select: { id: true, platform: true, accountName: true },
  });
  if (accounts.length === 0) {
    throw new PermanentJobError(
      ids.length
        ? 'The channels this step posts to are no longer connected.'
        : 'This step has no channels chosen, and the workspace has none connected.',
    );
  }
  const owner = await db.workspaceMember.findFirst({
    where: { workspaceId, role: 'OWNER' },
    select: { userId: true },
  });
  return accounts.map((account) => ({ ...account, workspaceOwnerId: owner?.userId ?? '' }));
}
