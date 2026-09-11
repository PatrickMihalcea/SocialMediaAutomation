'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';

const nameSchema = z.string().trim().min(1).max(80);
const allowedKeys = new Set(['q', 'type', 'status', 'platform', 'account', 'campaign', 'author', 'from', 'to', 'sort']);

export async function saveSearchViewAction(
  slug: string,
  rawQuery: Record<string, string | undefined>,
  formData: FormData,
) {
  const ctx = await requireWorkspace(slug, 'workspace:view');
  const name = nameSchema.parse(formData.get('name'));
  const query = Object.fromEntries(
    Object.entries(rawQuery).filter(([key, value]) => allowedKeys.has(key) && typeof value === 'string' && value.length > 0),
  );
  await db.savedSearchView.upsert({
    where: { workspaceId_name: { workspaceId: ctx.workspace.id, name } },
    create: { workspaceId: ctx.workspace.id, ownerId: ctx.user.id, name, query },
    update: { ownerId: ctx.user.id, query },
  });
  revalidatePath(`/w/${slug}/search`);
}

export async function deleteSearchViewAction(slug: string, viewId: string) {
  const ctx = await requireWorkspace(slug, 'workspace:view');
  await db.savedSearchView.deleteMany({
    where: { id: viewId, workspaceId: ctx.workspace.id, ownerId: ctx.user.id },
  });
  revalidatePath(`/w/${slug}/search`);
}
