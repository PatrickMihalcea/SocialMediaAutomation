'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { actionError, actionSuccess, type ActionState } from '@/lib/actions/state';
import { invalid, notFound } from '@/lib/errors';
import {
  campaignColor,
  campaignStatus,
  parseCampaignDate,
  validateCampaignDates,
} from '@/lib/campaigns/validation';

function refreshCampaignViews(slug: string, campaignId?: string) {
  revalidatePath(`/w/${slug}/campaigns`);
  if (campaignId) revalidatePath(`/w/${slug}/campaigns/${campaignId}`);
  revalidatePath(`/w/${slug}/calendar`);
  revalidatePath(`/w/${slug}/search`);
}

function campaignFields(formData: FormData) {
  const name = String(formData.get('name') || '').trim();
  if (!name) throw invalid('Campaign name is required.');
  const startDate = parseCampaignDate(formData.get('startDate'));
  const endDate = parseCampaignDate(formData.get('endDate'));
  validateCampaignDates(startDate, endDate);
  return {
    name,
    description: String(formData.get('description') || '').trim() || null,
    color: campaignColor(formData.get('color')),
    status: campaignStatus(formData.get('status')),
    startDate,
    endDate,
  };
}

export async function createCampaignAction(slug: string, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'campaign:manage');
    await db.campaign.create({
      data: {
        workspaceId: ctx.workspace.id,
        ...campaignFields(formData),
      },
    });
    refreshCampaignViews(slug);
    return actionSuccess('Campaign created.');
  } catch (error) {
    return actionError(error, 'The campaign could not be created.');
  }
}

export async function updateCampaignAction(
  slug: string,
  campaignId: string,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'campaign:manage');
    const result = await db.campaign.updateMany({
      where: { id: campaignId, workspaceId: ctx.workspace.id },
      data: campaignFields(formData),
    });
    if (!result.count) throw notFound('That campaign no longer exists.');
    refreshCampaignViews(slug, campaignId);
    return actionSuccess('Campaign updated.');
  } catch (error) {
    return actionError(error, 'The campaign could not be updated.');
  }
}

export async function setCampaignStatusAction(
  slug: string,
  campaignId: string,
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED',
): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'campaign:manage');
    const result = await db.campaign.updateMany({
      where: { id: campaignId, workspaceId: ctx.workspace.id },
      data: { status },
    });
    if (!result.count) throw notFound('That campaign no longer exists.');
    refreshCampaignViews(slug, campaignId);
    return actionSuccess(status === 'ARCHIVED' ? 'Campaign archived.' : 'Campaign status updated.');
  } catch (error) {
    return actionError(error, 'The campaign status could not be updated.');
  }
}

export async function assignCampaignPostsAction(
  slug: string,
  campaignId: string,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'campaign:manage');
    const postIds = formData.getAll('postIds').map(String);
    if (!postIds.length) throw invalid('Select at least one post.');
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!campaign) throw notFound('That campaign no longer exists.');
    const result = await db.post.updateMany({
      where: { id: { in: postIds }, workspaceId: ctx.workspace.id },
      data: { campaignId },
    });
    refreshCampaignViews(slug, campaignId);
    return actionSuccess(`${result.count} post${result.count === 1 ? '' : 's'} assigned.`);
  } catch (error) {
    return actionError(error, 'Posts could not be assigned.');
  }
}

export async function removeCampaignPostsAction(
  slug: string,
  campaignId: string,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'campaign:manage');
    const postIds = formData.getAll('postIds').map(String);
    if (!postIds.length) throw invalid('Select at least one post.');
    const result = await db.post.updateMany({
      where: { id: { in: postIds }, workspaceId: ctx.workspace.id, campaignId },
      data: { campaignId: null },
    });
    refreshCampaignViews(slug, campaignId);
    return actionSuccess(`${result.count} post${result.count === 1 ? '' : 's'} removed. The posts remain intact.`);
  } catch (error) {
    return actionError(error, 'Posts could not be removed.');
  }
}

export async function deleteCampaignAction(
  slug: string,
  campaignId: string,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'campaign:manage');
    const mode = String(formData.get('deleteMode') || '');
    const destinationId = String(formData.get('destinationId') || '');
    if (!['keep', 'move'].includes(mode)) {
      throw invalid('Choose what should happen to this campaign’s posts.');
    }
    if (mode === 'move' && (!destinationId || destinationId === campaignId)) {
      throw invalid('Choose another campaign for the posts.');
    }
    await db.$transaction(async (tx) => {
      const campaign = await tx.campaign.findFirst({
        where: { id: campaignId, workspaceId: ctx.workspace.id },
        select: { id: true },
      });
      if (!campaign) throw notFound('That campaign no longer exists.');
      if (mode === 'move') {
        const destination = await tx.campaign.findFirst({
          where: { id: destinationId, workspaceId: ctx.workspace.id },
          select: { id: true },
        });
        if (!destination) throw invalid('The destination campaign is no longer available.');
      }
      await tx.post.updateMany({
        where: { workspaceId: ctx.workspace.id, campaignId },
        data: { campaignId: mode === 'move' ? destinationId : null },
      });
      await tx.campaign.delete({ where: { id: campaignId } });
    });
    refreshCampaignViews(slug, campaignId);
    return actionSuccess('Campaign deleted. Its posts were kept.');
  } catch (error) {
    return actionError(error, 'The campaign could not be deleted.');
  }
}

export async function duplicateCampaignAction(
  slug: string,
  campaignId: string,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'campaign:manage');
    const includePosts = formData.get('includePosts') === 'on';
    const includeSchedule = formData.get('includeSchedule') === 'on';
    const source = await db.campaign.findFirst({
      where: { id: campaignId, workspaceId: ctx.workspace.id },
      include: includePosts ? { posts: { include: { platforms: { include: { media: true } } } } } : undefined,
    });
    if (!source) throw notFound('That campaign no longer exists.');
    const duplicate = await db.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          workspaceId: ctx.workspace.id,
          name: `${source.name} copy`,
          description: source.description,
          color: source.color,
          status: 'PLANNED',
          startDate: includeSchedule ? source.startDate : null,
          endDate: includeSchedule ? source.endDate : null,
        },
      });
      if (includePosts && 'posts' in source) {
        for (const post of source.posts) {
          await tx.post.create({
            data: {
              workspaceId: post.workspaceId,
              authorId: post.authorId,
              campaignId: created.id,
              status: includeSchedule && post.scheduledAt ? post.status : 'DRAFT',
              title: post.title,
              scheduledAt: includeSchedule ? post.scheduledAt : null,
              publishedAt: null,
              timezone: post.timezone,
              platforms: {
                create: post.platforms.map((platform) => ({
                  workspaceId: platform.workspaceId,
                  socialAccountId: platform.socialAccountId,
                  platform: platform.platform,
                  text: platform.text,
                  firstComment: platform.firstComment,
                  hashtags: platform.hashtags,
                  mentions: platform.mentions,
                  link: platform.link,
                  status: 'PENDING',
                  idempotencyKey: `campaign-copy:${randomUUID()}`,
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
        }
      }
      return created;
    });
    refreshCampaignViews(slug, duplicate.id);
    return actionSuccess(`Campaign duplicated as “${duplicate.name}”.`);
  } catch (error) {
    return actionError(error, 'The campaign could not be duplicated.');
  }
}
