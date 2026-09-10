'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';

export async function duplicateSearchPostAction(slug: string, postId: string) {
  const ctx = await requireWorkspace(slug, 'post:create');
  const source = await db.post.findFirst({
    where: { id: postId, workspaceId: ctx.workspace.id },
    include: { platforms: { include: { media: true } } },
  });
  if (!source) return;
  await db.post.create({
    data: {
      workspaceId: ctx.workspace.id,
      authorId: ctx.user.id,
      campaignId: source.campaignId,
      status: 'DRAFT',
      title: `${source.title ?? 'Untitled post'} copy`,
      timezone: source.timezone,
      platforms: {
        create: source.platforms.map((platform) => ({
          workspaceId: ctx.workspace.id,
          socialAccountId: platform.socialAccountId,
          platform: platform.platform,
          text: platform.text,
          firstComment: platform.firstComment,
          hashtags: platform.hashtags,
          mentions: platform.mentions,
          link: platform.link,
          idempotencyKey: randomUUID(),
          media: {
            create: platform.media.map((media) => ({
              mediaAssetId: media.mediaAssetId,
              position: media.position,
              altText: media.altText,
              thumbnailOffset: media.thumbnailOffset,
            })),
          },
        })),
      },
    },
  });
  revalidatePath(`/w/${slug}/search`);
}

export async function deleteSearchPostAction(slug: string, postId: string) {
  const ctx = await requireWorkspace(slug, 'post:delete');
  await db.post.deleteMany({ where: { id: postId, workspaceId: ctx.workspace.id } });
  revalidatePath(`/w/${slug}/search`);
}
