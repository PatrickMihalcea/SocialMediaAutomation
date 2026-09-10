'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Platform } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser, requireWorkspace } from '@/lib/auth/guard';
import { audit } from '@/lib/audit';
import { actionError, actionSuccess, type ActionState } from '@/lib/actions/state';
import { inferBrandVoice } from '@/lib/ai/service';
import { mediaKey, storage } from '@/lib/storage';
import { createDemoAccount } from '@/lib/social/accounts';
import {
  availableWorkspaceSlug,
  deleteWorkspaceWithStorage,
  slugifyWorkspace,
  timezoneChangeNotice,
} from '@/lib/workspaces/lifecycle';
import { conflict, invalid } from '@/lib/errors';
import type { BrandVoiceDraft } from '@/lib/ai/schemas';

const workspaceSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters.').max(80),
  slug: z.string().trim().max(80).optional(),
  website: z.string().trim().url('Enter a complete URL, including https://.').optional().or(z.literal('')),
  description: z.string().trim().max(2_000).optional(),
  targetAudience: z.string().trim().max(500).optional(),
  industry: z.string().trim().max(120).optional(),
  tone: z.string().trim().max(200).optional(),
  timezone: z.string().min(1).max(100).default('UTC'),
  defaultLanguage: z.string().trim().min(2).max(20).default('en'),
});

export type WorkspaceActionState = ActionState;
export type BrandVoicePreviewState = WorkspaceActionState & { preview?: BrandVoiceDraft };

export async function createWorkspaceAction(
  _state: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  let destination = '';
  try {
    const user = await requireUser();
    const input = workspaceSchema.parse(Object.fromEntries(formData));
    validateTimezone(input.timezone);
    const logo = formData.get('logo');
    if (logo instanceof File && logo.size) validateWorkspaceLogo(logo);
    const slug = await availableWorkspaceSlug(input.name);
    const workspace = await db.workspace.create({
      data: {
        name: input.name,
        slug,
        website: input.website || null,
        description: input.description || null,
        industry: input.industry || null,
        targetAudience: input.targetAudience || null,
        timezone: input.timezone,
        defaultLanguage: input.defaultLanguage,
        onboardingStep: 2,
        members: { create: { userId: user.id, role: 'OWNER' } },
        brandSettings: {
          create: {
            tone: input.tone || 'Professional and conversational',
            targetAudience: input.targetAudience || null,
            emojiPolicy: 'SPARING',
            hashtagPolicy: 'MODERATE',
          },
        },
        subscription: { create: { plan: 'FREE', status: 'ACTIVE' } },
        schedulingRules: {
          create: [
            { weekday: 1, hour: 9 },
            { weekday: 3, hour: 12 },
            { weekday: 5, hour: 9 },
          ],
        },
      },
    });
    await audit({
      workspaceId: workspace.id,
      userId: user.id,
      action: 'workspace.created',
      entityType: 'workspace',
      entityId: workspace.id,
    });
    if (logo instanceof File && logo.size) {
      const logoResult = await uploadWorkspaceLogoAction(workspace.slug, {}, formData);
      if (logoResult.status === 'error') {
        await deleteWorkspaceWithStorage(workspace.id);
        throw invalid(logoResult.error ?? 'The workspace logo could not be uploaded.');
      }
    }
    if (workspace.description) {
      try {
        const inferred = await inferBrandVoice({
          workspaceId: workspace.id,
          userId: user.id,
          description: [workspace.description, workspace.targetAudience, workspace.industry].filter(Boolean).join('\n'),
        });
        await db.brandSettings.update({ where: { workspaceId: workspace.id }, data: inferred });
      } catch (error) {
        console.error('[onboarding] brand voice inference failed', error);
      }
    }
    destination = `/onboarding?workspace=${encodeURIComponent(workspace.slug)}`;
  } catch (error) {
    return actionError(error, 'Check the workspace details and try again.');
  }
  redirect(destination);
}

export async function updateWorkspaceAction(
  slug: string,
  _state: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  let nextSlug = slug;
  let timezoneNotice = '';
  try {
    const ctx = await requireWorkspace(slug, 'workspace:update');
    const input = workspaceSchema.parse(Object.fromEntries(formData));
    validateTimezone(input.timezone);
    if (input.timezone !== ctx.workspace.timezone) {
      const scheduledPosts = await db.post.count({
        where: {
          workspaceId: ctx.workspace.id,
          scheduledAt: { not: null },
          status: { in: ['SCHEDULED', 'PENDING_APPROVAL'] },
        },
      });
      timezoneNotice = ` ${timezoneChangeNotice(input.timezone, scheduledPosts)}`;
    }
    const requested = slugifyWorkspace(input.slug || input.name);
    const collision = await db.workspace.findFirst({
      where: { slug: requested, id: { not: ctx.workspace.id } },
      select: { id: true },
    });
    if (collision) throw conflict('That workspace URL is already in use. Choose another slug.');
    nextSlug = requested;
    await db.workspace.update({
      where: { id: ctx.workspace.id },
      data: {
        name: input.name,
        slug: requested,
        website: input.website || null,
        description: input.description || null,
        industry: input.industry || null,
        targetAudience: input.targetAudience || null,
        timezone: input.timezone,
        defaultLanguage: input.defaultLanguage,
      },
    });
    await audit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: 'workspace.updated',
      entityType: 'workspace',
      entityId: ctx.workspace.id,
      metadata: { previousSlug: slug, slug: requested },
    });
  } catch (error) {
    return actionError(error, 'Check the workspace details and try again.');
  }
  revalidatePath(`/w/${nextSlug}/settings`);
  if (nextSlug !== slug) redirect(`/w/${nextSlug}/settings`);
  return actionSuccess(`Workspace details saved.${timezoneNotice}`);
}

const brandSchema = z.object({
  tone: z.string().trim().max(200),
  personality: z.string().trim().max(500),
  targetAudience: z.string().trim().max(500),
  writingStyle: z.string().trim().max(1_000),
  wordsToUse: z.string().max(1_000),
  wordsToAvoid: z.string().max(1_000),
  emojiPolicy: z.enum(['NONE', 'SPARING', 'FREELY']),
  hashtagPolicy: z.enum(['NONE', 'MINIMAL', 'MODERATE', 'HEAVY']),
  ctaStyle: z.string().trim().max(500),
  additionalInstructions: z.string().trim().max(2_000),
});

export async function updateBrandVoiceAction(
  slug: string,
  _state: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'brand:update');
    const input = brandSchema.parse(Object.fromEntries(formData));
    const list = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
    await db.brandSettings.upsert({
      where: { workspaceId: ctx.workspace.id },
      create: { workspaceId: ctx.workspace.id, ...input, wordsToUse: list(input.wordsToUse), wordsToAvoid: list(input.wordsToAvoid) },
      update: { ...input, wordsToUse: list(input.wordsToUse), wordsToAvoid: list(input.wordsToAvoid) },
    });
    await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: 'brand.updated', entityType: 'brand_settings', entityId: ctx.workspace.id });
    revalidatePath(`/w/${slug}/settings`);
    return actionSuccess('Brand voice saved.');
  } catch (error) {
    return actionError(error, 'Check the brand voice and try again.');
  }
}

export async function inferBrandVoiceAction(
  slug: string,
  _state: BrandVoicePreviewState,
  formData: FormData,
): Promise<BrandVoicePreviewState> {
  try {
    const ctx = await requireWorkspace(slug, 'brand:update');
    const description = z.string().trim().min(20, 'Add at least 20 characters of brand context.').max(4_000).parse(formData.get('description'));
    const inferred = await inferBrandVoice({ workspaceId: ctx.workspace.id, userId: ctx.user.id, description });
    return {
      status: 'success',
      success: 'Preview generated. Review and save it below to apply it.',
      preview: {
        ...inferred,
        wordsToUse: inferred.wordsToUse ?? [],
        wordsToAvoid: inferred.wordsToAvoid ?? [],
        emojiPolicy: inferred.emojiPolicy ?? 'SPARING',
        hashtagPolicy: inferred.hashtagPolicy ?? 'MODERATE',
        additionalInstructions: inferred.additionalInstructions ?? '',
      },
    };
  } catch (error) {
    return actionError(error, 'Bridge88 could not infer the brand voice. Edit the preview manually or try again.');
  }
}

export async function uploadWorkspaceLogoAction(
  slug: string,
  _state: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  let uploadedKey: string | null = null;
  let committed = false;
  try {
    const ctx = await requireWorkspace(slug, 'workspace:update');
    const file = formData.get('logo');
    if (!(file instanceof File) || !file.size) throw invalid('Choose a logo file.');
    validateWorkspaceLogo(file);
    uploadedKey = mediaKey(ctx.workspace.id, file.name, 'original');
    await storage().put(uploadedKey, Buffer.from(await file.arrayBuffer()), file.type);
    const oldKey = ctx.workspace.logoStorageKey;
    const logoUrl = await storage().signedUrl(uploadedKey, 30 * 24 * 60 * 60);
    await db.workspace.update({ where: { id: ctx.workspace.id }, data: { logoStorageKey: uploadedKey, logoUrl } });
    committed = true;
    if (oldKey) {
      await storage().delete(oldKey).catch((error) => {
        console.error('[workspace] old logo cleanup failed', error);
      });
    }
    await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: 'workspace.logo_updated', entityType: 'workspace', entityId: ctx.workspace.id, metadata: { mimeType: file.type, size: file.size } });
    revalidatePath(`/w/${slug}/settings`);
    return actionSuccess('Workspace logo updated.');
  } catch (error) {
    if (uploadedKey && !committed) await storage().delete(uploadedKey).catch(() => undefined);
    return actionError(error, 'The logo could not be uploaded.');
  }
}

export async function advanceOnboardingAction(
  slug: string,
  step: number,
  _state: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  try {
    const ctx = await requireWorkspace(slug);
    if (ctx.workspace.onboardedAt) return actionSuccess('Onboarding is already complete.');
    if (step !== ctx.workspace.onboardingStep) throw conflict('This onboarding step is no longer current. Refresh the page.');
    const skipped = formData.get('skip') === 'true';
    if (step === 2) {
      if (!ctx.can('brand:update')) throw invalid('Your role cannot edit the brand voice.');
      const result = await updateBrandVoiceAction(slug, {}, formData);
      if (result.status === 'error') return result;
    }
    if (step === 3 && !skipped && formData.get('platform')) {
      const platform = z.nativeEnum(Platform).parse(formData.get('platform'));
      if (platform === Platform.MOCK) throw invalid('Choose a social platform.');
      if (!ctx.can('channel:connect')) throw invalid('Your role cannot connect channels.');
      const account = await createDemoAccount({
        workspaceId: ctx.workspace.id,
        platform,
        accountName: `${ctx.workspace.name} demo`,
        handle: `@${ctx.workspace.slug}`,
      });
      await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: 'channel.connected', entityType: 'social_account', entityId: account.id, metadata: { platform, mock: true, onboarding: true } });
    }
    if (step === 4 && !skipped && String(formData.get('text') || '').trim()) {
      const account = await db.socialAccount.findFirst({ where: { workspaceId: ctx.workspace.id, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
      if (!account) throw invalid('Connect a demo channel before creating the first post, or skip this step.');
      const text = z.string().trim().min(1).max(5_000).parse(formData.get('text'));
      const post = await db.post.create({
        data: {
          workspaceId: ctx.workspace.id,
          authorId: ctx.user.id,
          title: String(formData.get('title') || '').trim() || 'First post',
          status: 'DRAFT',
          timezone: ctx.workspace.timezone,
          platforms: { create: { workspaceId: ctx.workspace.id, socialAccountId: account.id, platform: account.platform, text, idempotencyKey: crypto.randomUUID() } },
        },
      });
      await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: 'post.created', entityType: 'post', entityId: post.id, metadata: { onboarding: true } });
    }
    const complete = step >= 4;
    await db.workspace.update({
      where: { id: ctx.workspace.id },
      data: { onboardingStep: Math.min(4, step + 1), onboardedAt: complete ? new Date() : null },
    });
    await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: complete ? 'onboarding.completed' : 'onboarding.progressed', entityType: 'workspace', entityId: ctx.workspace.id, metadata: { step, skipped } });
  } catch (error) {
    return actionError(error, 'This onboarding step could not be saved.');
  }
  if (step >= 4) redirect(`/w/${slug}`);
  revalidatePath('/onboarding');
  return actionSuccess('Progress saved.');
}

export async function transferWorkspaceOwnershipAction(
  slug: string,
  _state: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  try {
    const ctx = await requireWorkspace(slug, 'workspace:transfer');
    const confirmation = String(formData.get('confirmation') || '').trim();
    if (confirmation !== 'TRANSFER') throw invalid('Type TRANSFER exactly to confirm the ownership change.');
    const email = z.string().email('Enter a member email.').parse(formData.get('email')).toLowerCase();
    const nextOwner = await db.workspaceMember.findFirst({ where: { workspaceId: ctx.workspace.id, user: { email } }, include: { user: true } });
    if (!nextOwner) throw invalid('That email must belong to an existing workspace member.');
    if (nextOwner.userId === ctx.user.id) throw invalid('You already own this workspace.');
    await db.$transaction([
      db.workspaceMember.update({ where: { id: nextOwner.id }, data: { role: 'OWNER' } }),
      db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: ctx.workspace.id, userId: ctx.user.id } }, data: { role: 'ADMIN' } }),
    ]);
    await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: 'workspace.ownership_transferred', entityType: 'workspace', entityId: ctx.workspace.id, metadata: { newOwnerId: nextOwner.userId } });
    revalidatePath(`/w/${slug}/team`);
  } catch (error) {
    return actionError(error, 'Ownership could not be transferred.');
  }
  redirect(`/w/${slug}/team?ownershipTransferred=1`);
}

export async function deleteWorkspaceAction(
  slug: string,
  _state: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  let destination = '/w';
  try {
    const ctx = await requireWorkspace(slug, 'workspace:delete');
    const confirmation = String(formData.get('confirmation') || '').trim();
    if (confirmation !== ctx.workspace.name) throw invalid(`Type “${ctx.workspace.name}” exactly to delete this workspace.`);
    await audit({ userId: ctx.user.id, action: 'workspace.deleted', entityType: 'workspace', entityId: ctx.workspace.id, metadata: { name: ctx.workspace.name, slug } });
    await deleteWorkspaceWithStorage(ctx.workspace.id);
    const remaining = await db.workspaceMember.findFirst({ where: { userId: ctx.user.id }, include: { workspace: true }, orderBy: { createdAt: 'asc' } });
    destination = remaining ? `/w/${remaining.workspace.slug}` : '/onboarding';
  } catch (error) {
    return actionError(error, 'The workspace could not be deleted.');
  }
  redirect(destination);
}

function validateTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
  } catch {
    throw invalid('Choose a valid timezone.', { timezone: ['Choose a valid IANA timezone.'] });
  }
}

function validateWorkspaceLogo(file: File): void {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowed.has(file.type)) throw invalid('Use a JPG, PNG, or WebP logo.');
  if (file.size > 2 * 1024 * 1024) throw invalid('The logo must be 2 MB or smaller.');
}
