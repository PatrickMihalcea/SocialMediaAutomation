'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { actionError, actionSuccess, type ActionState } from '@/lib/actions/state';
import { invalid, notFound } from '@/lib/errors';
import { campaignAuditPayload, type CampaignAuditKind } from '@/lib/campaigns/audit';
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
  revalidatePath(`/w/${slug}/history`);
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

function statusLabel(status: string) {
  if (status === 'PLANNED') return 'Draft';
  const text = status.toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dateLabel(value: Date | null) {
  return value
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(value)
    : 'Not set';
}

async function recordCampaignAudit(
  ctx: Awaited<ReturnType<typeof requireWorkspace>>,
  kind: CampaignAuditKind,
  campaignId: string,
  metadata: Record<string, unknown>,
) {
  await audit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    ...campaignAuditPayload({ kind, campaignId, metadata }),
  });
}

export async function createCampaignAction(slug: string, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'campaign:manage');
    const campaign = await db.campaign.create({
      data: {
        workspaceId: ctx.workspace.id,
        ...campaignFields(formData),
      },
    });
    await recordCampaignAudit(ctx, 'created', campaign.id, {
      campaignName: campaign.name,
      summary: `Created “${campaign.name}” as ${statusLabel(campaign.status)}.`,
      status: statusLabel(campaign.status),
      startDate: dateLabel(campaign.startDate),
      endDate: dateLabel(campaign.endDate),
      color: statusLabel(campaign.color),
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
    const before = await db.campaign.findFirst({
      where: { id: campaignId, workspaceId: ctx.workspace.id },
    });
    if (!before) throw notFound('That campaign no longer exists.');
    const next = campaignFields(formData);
    const result = await db.campaign.updateMany({
      where: { id: campaignId, workspaceId: ctx.workspace.id },
      data: next,
    });
    if (!result.count) throw notFound('That campaign no longer exists.');
    const metadataChanges = [
      before.name !== next.name ? { field: 'Name', from: before.name, to: next.name } : null,
      before.description !== next.description ? { field: 'Description', from: before.description ?? 'Not set', to: next.description ?? 'Not set' } : null,
      before.color !== next.color ? { field: 'Color', from: statusLabel(before.color), to: statusLabel(next.color) } : null,
      before.startDate?.getTime() !== next.startDate?.getTime() ? { field: 'Start date', from: dateLabel(before.startDate), to: dateLabel(next.startDate) } : null,
      before.endDate?.getTime() !== next.endDate?.getTime() ? { field: 'End date', from: dateLabel(before.endDate), to: dateLabel(next.endDate) } : null,
    ].filter((change): change is { field: string; from: string; to: string } => Boolean(change));
    if (metadataChanges.length || before.status === next.status) {
      await recordCampaignAudit(ctx, 'updated', campaignId, {
        campaignName: next.name,
        previousCampaignName: before.name,
        summary: metadataChanges.length
          ? `Changed ${metadataChanges.map((change) => change.field.toLowerCase()).join(', ')}.`
          : 'Saved the campaign without changing its metadata.',
        changes: metadataChanges,
      });
    }
    if (before.status !== next.status) {
      await recordCampaignAudit(ctx, next.status === 'ARCHIVED' ? 'archived' : 'statusChanged', campaignId, {
        campaignName: next.name,
        summary: next.status === 'ARCHIVED'
          ? `Archived “${next.name}” from ${statusLabel(before.status)}.`
          : `Changed “${next.name}” from ${statusLabel(before.status)} to ${statusLabel(next.status)}.`,
        fromStatus: statusLabel(before.status),
        toStatus: statusLabel(next.status),
      });
    }
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
    const before = await db.campaign.findFirst({
      where: { id: campaignId, workspaceId: ctx.workspace.id },
      select: { id: true, name: true, status: true },
    });
    if (!before) throw notFound('That campaign no longer exists.');
    const result = await db.campaign.updateMany({
      where: { id: campaignId, workspaceId: ctx.workspace.id },
      data: { status },
    });
    if (!result.count) throw notFound('That campaign no longer exists.');
    await recordCampaignAudit(ctx, status === 'ARCHIVED' ? 'archived' : 'statusChanged', campaignId, {
      campaignName: before.name,
      summary: status === 'ARCHIVED'
        ? `Archived “${before.name}” from ${statusLabel(before.status)}.`
        : `Changed “${before.name}” from ${statusLabel(before.status)} to ${statusLabel(status)}.`,
      fromStatus: statusLabel(before.status),
      toStatus: statusLabel(status),
    });
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
      select: { id: true, name: true },
    });
    if (!campaign) throw notFound('That campaign no longer exists.');
    const posts = await db.post.findMany({
      where: { id: { in: postIds }, workspaceId: ctx.workspace.id },
      select: { id: true, title: true, campaign: { select: { name: true } } },
    });
    const result = await db.post.updateMany({
      where: { id: { in: postIds }, workspaceId: ctx.workspace.id },
      data: { campaignId },
    });
    await recordCampaignAudit(ctx, 'postsAssigned', campaignId, {
      campaignName: campaign.name,
      summary: `Assigned ${result.count} post${result.count === 1 ? '' : 's'} to “${campaign.name}”.`,
      postCount: result.count,
      posts: posts.map((post) => ({
        postId: post.id,
        postTitle: post.title?.trim() || 'Untitled post',
        fromCampaign: post.campaign?.name ?? 'No campaign',
        toCampaign: campaign.name,
      })),
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
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, workspaceId: ctx.workspace.id },
      select: { id: true, name: true },
    });
    if (!campaign) throw notFound('That campaign no longer exists.');
    const posts = await db.post.findMany({
      where: { id: { in: postIds }, workspaceId: ctx.workspace.id, campaignId },
      select: { id: true, title: true },
    });
    const result = await db.post.updateMany({
      where: { id: { in: postIds }, workspaceId: ctx.workspace.id, campaignId },
      data: { campaignId: null },
    });
    await recordCampaignAudit(ctx, 'postsRemoved', campaignId, {
      campaignName: campaign.name,
      summary: `Removed ${result.count} post${result.count === 1 ? '' : 's'} from “${campaign.name}” and kept ${result.count === 1 ? 'it' : 'them'} uncategorized.`,
      postCount: result.count,
      posts: posts.map((post) => ({
        postId: post.id,
        postTitle: post.title?.trim() || 'Untitled post',
        fromCampaign: campaign.name,
        toCampaign: 'No campaign',
      })),
    });
    refreshCampaignViews(slug, campaignId);
    return actionSuccess(`${result.count} post${result.count === 1 ? '' : 's'} removed. The posts remain intact.`);
  } catch (error) {
    return actionError(error, 'Posts could not be removed.');
  }
}

export async function moveCampaignPostsAction(
  slug: string,
  sourceCampaignId: string,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'campaign:manage');
    const destinationId = String(formData.get('destinationId') || '');
    const postIds = formData.getAll('postIds').map(String);
    if (!postIds.length) throw invalid('Select at least one post.');
    if (!destinationId || destinationId === sourceCampaignId) {
      throw invalid('Choose a different destination campaign.');
    }
    const [source, destination, posts] = await Promise.all([
      db.campaign.findFirst({
        where: { id: sourceCampaignId, workspaceId: ctx.workspace.id },
        select: { id: true, name: true },
      }),
      db.campaign.findFirst({
        where: { id: destinationId, workspaceId: ctx.workspace.id },
        select: { id: true, name: true },
      }),
      db.post.findMany({
        where: { id: { in: postIds }, workspaceId: ctx.workspace.id, campaignId: sourceCampaignId },
        select: { id: true, title: true },
      }),
    ]);
    if (!source) throw notFound('That campaign no longer exists.');
    if (!destination) throw invalid('The destination campaign is no longer available.');
    const result = await db.post.updateMany({
      where: { id: { in: postIds }, workspaceId: ctx.workspace.id, campaignId: sourceCampaignId },
      data: { campaignId: destinationId },
    });
    const metadata = {
      campaignName: source.name,
      summary: `Moved ${result.count} post${result.count === 1 ? '' : 's'} from “${source.name}” to “${destination.name}”.`,
      postCount: result.count,
      fromCampaign: source.name,
      toCampaign: destination.name,
      destinationCampaignId: destination.id,
      posts: posts.map((post) => ({
        postId: post.id,
        postTitle: post.title?.trim() || 'Untitled post',
      })),
    };
    await recordCampaignAudit(ctx, 'postsMoved', sourceCampaignId, metadata);
    await recordCampaignAudit(ctx, 'postsAssigned', destinationId, {
      ...metadata,
      campaignName: destination.name,
      summary: `Received ${result.count} post${result.count === 1 ? '' : 's'} from “${source.name}”.`,
    });
    refreshCampaignViews(slug, sourceCampaignId);
    refreshCampaignViews(slug, destinationId);
    return actionSuccess(`${result.count} post${result.count === 1 ? '' : 's'} moved.`);
  } catch (error) {
    return actionError(error, 'Posts could not be moved.');
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
    const deleted = await db.$transaction(async (tx) => {
      const campaign = await tx.campaign.findFirst({
        where: { id: campaignId, workspaceId: ctx.workspace.id },
        select: { id: true, name: true },
      });
      if (!campaign) throw notFound('That campaign no longer exists.');
      const postCount = await tx.post.count({
        where: { workspaceId: ctx.workspace.id, campaignId },
      });
      let destination: { id: string; name: string } | null = null;
      if (mode === 'move') {
        destination = await tx.campaign.findFirst({
          where: { id: destinationId, workspaceId: ctx.workspace.id },
          select: { id: true, name: true },
        });
        if (!destination) throw invalid('The destination campaign is no longer available.');
      }
      await tx.post.updateMany({
        where: { workspaceId: ctx.workspace.id, campaignId },
        data: { campaignId: mode === 'move' ? destinationId : null },
      });
      await tx.campaign.delete({ where: { id: campaignId } });
      return { campaign, destination, postCount };
    });
    const disposition = mode === 'move' && deleted.destination
      ? `Moved ${deleted.postCount} post${deleted.postCount === 1 ? '' : 's'} to “${deleted.destination.name}”.`
      : `Kept ${deleted.postCount} post${deleted.postCount === 1 ? '' : 's'} without a campaign.`;
    await recordCampaignAudit(ctx, 'deleted', campaignId, {
      campaignName: deleted.campaign.name,
      summary: `Deleted “${deleted.campaign.name}”. ${disposition}`,
      disposition,
      postCount: deleted.postCount,
      destinationCampaignId: deleted.destination?.id ?? null,
      destinationCampaignName: deleted.destination?.name ?? null,
    });
    refreshCampaignViews(slug, campaignId);
    return actionSuccess(mode === 'move' ? 'Campaign deleted. Its posts were moved.' : 'Campaign deleted. Its posts were kept.');
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
      include: { posts: { include: { platforms: { include: { media: true } } } } },
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
      if (includePosts) {
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
    await recordCampaignAudit(ctx, 'duplicated', duplicate.id, {
      campaignName: duplicate.name,
      sourceCampaignId: source.id,
      sourceCampaignName: source.name,
      summary: `Created “${duplicate.name}” as an independent copy of “${source.name}”.`,
      copiedPosts: includePosts ? source.posts.length : 0,
      copiedSchedule: includeSchedule ? 'Included campaign dates and post publish times.' : 'Did not include campaign dates or post publish times.',
    });
    refreshCampaignViews(slug, duplicate.id);
    return actionSuccess(`Campaign duplicated as “${duplicate.name}”.`);
  } catch (error) {
    return actionError(error, 'The campaign could not be duplicated.');
  }
}
