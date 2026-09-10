'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformAdmin } from '@/lib/auth/guard';
import { db } from '@/lib/db';

export async function retryJobAction(jobId: string) {
  await requirePlatformAdmin();
  await db.job.updateMany({
    where: { id: jobId, status: { in: ['FAILED', 'CANCELLED'] } },
    data: { status: 'QUEUED', error: null, runAt: new Date(), completedAt: null, dedupeKey: null },
  });
  revalidatePath('/admin');
}

export async function cancelJobAction(jobId: string) {
  await requirePlatformAdmin();
  await db.job.updateMany({
    where: { id: jobId, status: { in: ['QUEUED', 'RUNNING'] } },
    data: { status: 'CANCELLED', completedAt: new Date(), dedupeKey: null },
  });
  revalidatePath('/admin');
}
