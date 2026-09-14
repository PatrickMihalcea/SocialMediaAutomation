import 'server-only';
import { PostStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { savePost } from '@/lib/posts/service';
import { addToQueue } from '@/lib/scheduling/queue';
import { enqueue } from '@/lib/queue';
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
    select: { timezone: true, queuePaused: true },
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

  if (config.requireApproval) {
    await notifyRoles(ctx.workspaceId, ['OWNER', 'ADMIN'], {
      type: 'APPROVAL_REQUESTED',
      title: `"${ctx.nodeName}" produced a post for review`,
      body: `A workflow created a post for ${accounts.map((a) => a.accountName).join(', ')}.`,
      href: `/w/${ctx.workspaceId}/drafts`,
    });
    return { post: { id: post.id, status: post.status, awaitingApproval: true } };
  }

  if (config.mode === 'queue') {
    if (workspace.queuePaused) {
      throw new PermanentJobError('The queue is paused, so this post was not scheduled.');
    }
    const slot = await addToQueue(ctx.workspaceId, post.id);
    return { post: { id: post.id, status: PostStatus.SCHEDULED, scheduledAt: slot.toISOString() } };
  }

  await db.post.update({
    where: { id: post.id },
    data: { status: PostStatus.SCHEDULED, scheduledAt: new Date() },
  });
  await enqueue(
    'publish-post',
    { postId: post.id },
    { workspaceId: ctx.workspaceId, dedupeKey: `publish:${post.id}` },
  );

  return { post: { id: post.id, status: PostStatus.SCHEDULED } };
}
