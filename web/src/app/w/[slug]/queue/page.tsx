import { Suspense } from 'react';
import { Button } from '@/bridge88/components';
import { QueuePagePreview } from '@/components/page-previews';
import { QueueManager } from '@/components/queue-manager';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { listSlots } from '@/lib/scheduling/queue';
import type { RecurrenceTemplate } from '@/lib/scheduling/recurrence';
import { formatInZone } from '@/lib/scheduling/time';
import { PLATFORM_LABELS } from '@/lib/social/registry';

export const metadata = { title: 'Queue' };

export default function QueuePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <>
      <div><p className="b88-eyebrow">Queue</p><h1 className="b88-page-title mt-3">Smart publishing queue</h1></div>
      <Suspense fallback={<QueuePagePreview />}>
        <QueueData params={params} />
      </Suspense>
    </>
  );
}
async function QueueData({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'post:view');
  const [rules, items, skippedItems, drafts, slots, recurrences, accounts, campaigns] = await Promise.all([
    db.schedulingRule.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: [{ weekday: 'asc' }, { hour: 'asc' }, { minute: 'asc' }] }),
    db.queueItem.findMany({ where: { workspaceId: ctx.workspace.id, postId: { not: null } }, include: { post: { include: { platforms: { take: 1 } } } }, orderBy: { position: 'asc' } }),
    db.queueItem.findMany({ where: { workspaceId: ctx.workspace.id, skipped: true, postId: null }, orderBy: { slotAt: 'asc' } }),
    db.post.findMany({ where: { workspaceId: ctx.workspace.id, status: { in: ['DRAFT', 'REJECTED', 'APPROVED', 'SCHEDULED'] }, queueItem: null, recurringScheduleId: null }, include: { platforms: { take: 1 } }, orderBy: { updatedAt: 'desc' }, take: 12 }),
    listSlots(ctx.workspace.id, 50),
    db.recurringSchedule.findMany({
      where: { workspaceId: ctx.workspace.id },
      include: {
        posts: {
          where: { scheduledAt: { gte: new Date() } },
          select: { id: true, title: true, scheduledAt: true, status: true },
          orderBy: { scheduledAt: 'asc' },
          take: 8,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.socialAccount.findMany({ where: { workspaceId: ctx.workspace.id, status: 'ACTIVE' }, select: { id: true, accountName: true, platform: true }, orderBy: { accountName: 'asc' } }),
    db.campaign.findMany({ where: { workspaceId: ctx.workspace.id }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const nextSlot = slots.find((slot) => !slot.taken)?.at.toISOString() ?? null;

  return (
    <div className="mt-6 min-h-[680px]">
      <div className="flex justify-end">
        <Button href={`/w/${slug}/compose`}>Create post</Button>
      </div>
      <QueueManager
        slug={slug}
        timezone={ctx.workspace.timezone}
        paused={ctx.workspace.queuePaused}
        rules={rules.map((rule) => ({ id: rule.id, weekday: rule.weekday, hour: rule.hour, minute: rule.minute, enabled: rule.enabled }))}
        queuePosts={items.flatMap((item) => item.postId && item.post ? [{ id: item.postId, title: item.post.title ?? item.post.platforms[0]?.text.slice(0, 60) ?? 'Untitled post', slotAt: item.slotAt.toISOString() }] : [])}
        skippedSlots={skippedItems.map((item) => ({ id: item.id, slotAt: item.slotAt.toISOString() }))}
        drafts={drafts.map((post) => ({ id: post.id, title: post.title ?? post.platforms[0]?.text.slice(0, 30) ?? 'Untitled post' }))}
        nextSlot={nextSlot}
        recurrences={recurrences.map((recurrence) => {
          const template = recurrence.template as unknown as RecurrenceTemplate;
          return {
            id: recurrence.id,
            name: recurrence.name,
            title: template.title ?? '',
            text: template.platforms?.[0]?.text ?? '',
            socialAccountId: template.platforms?.[0]?.socialAccountId ?? '',
            campaignId: template.campaignId ?? '',
            frequency: template.frequency ?? 'weekly',
            weekdays: recurrence.weekdays,
            hour: recurrence.hour,
            minute: recurrence.minute,
            startDate: formatInZone(recurrence.startDate, ctx.workspace.timezone, 'yyyy-MM-dd'),
            endDate: recurrence.endDate ? formatInZone(recurrence.endDate, ctx.workspace.timezone, 'yyyy-MM-dd') : '',
            status: recurrence.status,
            occurrences: recurrence.posts.map((post) => ({
              id: post.id,
              title: post.title ?? template.title ?? recurrence.name,
              scheduledAt: post.scheduledAt!.toISOString(),
              status: post.status,
            })),
          };
        })}
        accounts={accounts.map((account) => ({ value: account.id, label: `${account.accountName} · ${PLATFORM_LABELS[account.platform]}` }))}
        campaigns={campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name }))}
        canManage={ctx.can('schedule:manage')}
      />
    </div>
  );
}
