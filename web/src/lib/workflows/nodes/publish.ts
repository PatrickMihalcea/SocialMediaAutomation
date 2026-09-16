import 'server-only';
import { PostStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { savePost } from '@/lib/posts/service';
import { releasePost } from '@/lib/posts/release';
import { PermanentJobError } from '@/lib/queue/runner';
import { notifyRoles } from '@/lib/notifications/service';
import { resolveAccounts } from '@/lib/workflows/nodes/create-draft';
import type { NodeRunContext } from '@/lib/workflows/node-context';

interface Config {
  socialAccountIds: string[];
  caption: string;
  mode: 'now' | 'queue';
  requireApproval: boolean;
}

/**
 * The terminal step: sends the finished video to real channels.
 *
 * `requireApproval` defaults on, and that default is deliberate. Everything
 * upstream of here is reversible — a bad image costs a regeneration — but a
 * published post is not, and a scheduled run publishes with nobody watching.
 * With it on, the workflow produces a post awaiting approval and tells the
 * admins; publishing still needs a person.
 */
export async function run(ctx: NodeRunContext): Promise<Record<string, unknown>> {
  const config = ctx.config as Config;
  const videoId = typeof ctx.inputs.video === 'string' ? ctx.inputs.video : null;
  if (!videoId) throw new PermanentJobError('No video reached this step.');

  const accounts = await resolveAccounts(ctx.workspaceId, config.socialAccountIds);
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { slug: true, timezone: true, queuePaused: true },
  });

  const status = config.requireApproval ? PostStatus.PENDING_APPROVAL : PostStatus.DRAFT;

  const post = await savePost(
    ctx.workspaceId,
    ctx.userId ?? accounts[0].workspaceOwnerId,
    {
      title: ctx.nodeName,
      timezone: workspace.timezone,
      status,
      scheduledAt: null,
      platforms: accounts.map((account) => ({
        socialAccountId: account.id,
        platform: account.platform,
        text: config.caption,
        hashtags: [],
        mentions: [],
        media: [{ mediaAssetId: videoId }],
      })),
    },
    // Validated here, unlike the draft node: this post is headed for a real
    // channel, so a caption over the limit must stop the step, not the publish.
    { validateContent: true },
  );

  // Stamped on every post this step makes, approval or not. It is the only
  // record that a workflow produced this post; without it a reviewer meets a
  // post with no explicable origin — no workflow, no run, no step.
  await db.post.update({
    where: { id: post.id },
    data: {
      workflowNodeRunId: ctx.nodeRunId,
      // Carried across the approval pause. Returning below used to drop the
      // configured mode on the floor, so an approved post sat APPROVED forever
      // while the engine only ever publishes SCHEDULED ones.
      releaseOnApproval: config.requireApproval ? config.mode : null,
    },
  });

  if (config.requireApproval) {
    await notifyRoles(ctx.workspaceId, ['OWNER', 'ADMIN'], {
      type: 'APPROVAL_REQUESTED',
      title: `"${ctx.nodeName}" produced a post for review`,
      body: `A workflow created a post for ${accounts.map((a) => a.accountName).join(', ')}.`,
      // slug, not workspaceId: routes are /w/{slug}/..., so the id built a
      // link that resolved to nothing — the one notification in the codebase
      // that got this wrong.
      // The post itself, not the drafts list: a reviewer needs the caption, the
      // media and the channels in front of them, and a pending post is not in
      // drafts anyway.
      href: `/w/${workspace.slug}/posts/${post.id}`,
    });
    return { post: { id: post.id, status: post.status, awaitingApproval: true } };
  }

  if (config.mode === 'queue' && workspace.queuePaused) {
    throw new PermanentJobError('The queue is paused, so this post was not scheduled.');
  }
  const scheduledAt = await releasePost(ctx.workspaceId, post.id, config.mode);

  return {
    post: { id: post.id, status: PostStatus.SCHEDULED, scheduledAt: scheduledAt.toISOString() },
  };
}
