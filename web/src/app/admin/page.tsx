import { Suspense } from 'react';
import { Badge, Button, EmptyState, StatCard } from '@/bridge88/components';
import Link from 'next/link';
import { AdminPagePreview } from '@/components/page-previews';
import { requirePlatformAdmin } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { AppError } from '@/lib/errors';
import { AdminJobActions } from './job-actions';
import { POST_STATUS_LABELS } from '@/lib/posts/labels';
import { JOB_STATUS_LABELS } from '@/lib/ai/labels';
import type { ReactNode } from 'react';

export const metadata = { title: 'Admin' };

const PLAN_LABELS: Record<string, string> = { FREE: 'Free', PRO: 'Pro', BUSINESS: 'Business' };
const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  TRIALING: 'Trial',
  PAST_DUE: 'Payment overdue',
  CANCELED: 'Cancelled',
  INCOMPLETE: 'Setup incomplete',
  UNPAID: 'Unpaid',
};
const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Reconnect required',
  REVOKED: 'Access revoked',
  ERROR: 'Needs attention',
  DISCONNECTED: 'Disconnected',
};
const AI_OPERATION_LABELS: Record<string, string> = {
  CAPTION: 'Caption writing',
  REWRITE: 'Copy rewrite',
  HASHTAGS: 'Hashtag suggestions',
  IDEAS: 'Content ideas',
  IMAGE: 'Image generation',
  IMAGE_EDIT: 'Image editing',
  VIDEO: 'Video generation',
  AUDIO: 'Audio generation',
  PLATFORM_ADAPTATION: 'Channel adaptation',
  CHAT: 'Assistant conversation',
  CALENDAR: 'Calendar planning',
};
const USAGE_LABELS: Record<string, string> = {
  ai_generations: 'AI generations',
  scheduled_posts: 'Scheduled posts',
  media_storage_bytes: 'Media storage',
};

export default async function AdminPage() {
  try {
    await requirePlatformAdmin();
  } catch (error) {
    if (error instanceof AppError && error.code === 'FORBIDDEN') {
      return (
        <main id="main-content" className="mx-auto max-w-2xl px-6 py-12 md:px-12" tabIndex={-1}>
          <Link href="/w" className="text-xl font-[540]">Bridge88</Link>
          <section className="b88-card mt-12">
            <p className="b88-eyebrow">Platform administration</p>
            <h1 className="b88-page-title mt-3">This area is for Bridge88 operators.</h1>
            <Button href="/w" className="mt-6">Open workspace</Button>
          </section>
        </main>
      );
    }
    throw error;
  }
  return (
    <main id="main-content" className="mx-auto max-w-[1280px] px-6 py-12 md:px-12" tabIndex={-1}>
      <Link href="/w" className="text-xl font-[540]">Bridge88</Link>
      <p className="b88-eyebrow mt-12">Platform administration</p><h1 className="b88-page-title mt-3">System health</h1>
      <Suspense fallback={<AdminPagePreview />}>
        <AdminStats />
        <AdminTables />
      </Suspense>
    </main>
  );
}

async function AdminStats() {
  const [users, workspaces, accounts, posts, aiUsage, aiCost, storage] = await Promise.all([
    db.user.count(),
    db.workspace.count(),
    db.socialAccount.count(),
    db.post.count(),
    db.aiGeneration.count(),
    db.aiGeneration.aggregate({ _sum: { estimatedCost: true, totalTokens: true } }),
    db.mediaAsset.aggregate({ _sum: { size: true } }),
  ]);
  return (
    <div className="mt-8">
      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
        <StatCard label="Users" value={String(users)}/><StatCard label="Workspaces" value={String(workspaces)}/>
        <StatCard label="Social accounts" value={String(accounts)}/><StatCard label="Posts" value={String(posts)}/>
        <StatCard label="AI generations" value={String(aiUsage)}/><StatCard label="Storage" value={`${((storage._sum.size ?? 0) / 1024 / 1024).toFixed(1)} MB`}/>
        <StatCard label="AI tokens" value={(aiCost._sum.totalTokens ?? 0).toLocaleString()}/><StatCard label="AI cost" value={`$${Number(aiCost._sum.estimatedCost ?? 0).toFixed(2)}`}/>
      </div>
      <section className="b88-card mt-8"><p className="b88-caption">Health</p><h2 className="b88-heading mt-2">Runtime checks</h2><p className="mt-4">Database available · admin query completed</p></section>
    </div>
  );
}

async function AdminTables() {
  const [jobs, subscriptions, audits, recentUsers, recentWorkspaces, recentAccounts, recentPosts, recentAi, usageRecords] = await Promise.all([
    db.job.findMany({ include: { workspace: { select: { name: true, slug: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.subscription.findMany({ include: { workspace: { select: { name: true, slug: true } } }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    db.auditLog.findMany({ include: { user: { select: { email: true } }, workspace: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 30 }),
    db.user.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, email: true, name: true, createdAt: true, isPlatformAdmin: true } }),
    db.workspace.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { _count: { select: { members: true } }, subscription: true } }),
    db.socialAccount.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { workspace: { select: { name: true, slug: true } } } }),
    db.post.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { workspace: { select: { name: true, slug: true } } } }),
    db.aiGeneration.findMany({ include: { workspace: { select: { name: true, slug: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    db.usageRecord.findMany({ include: { workspace: { select: { name: true, slug: true } } }, orderBy: { updatedAt: 'desc' }, take: 30 }),
  ]);
  return (
    <div className="mt-8 min-h-[817px]">
      <div className="grid gap-6 xl:grid-cols-2">
        <AdminList title="Users" rows={recentUsers.map((item) => ({ key: item.id, label: item.name ?? item.email, meta: `${item.email} · ${item.isPlatformAdmin ? 'Platform admin' : 'User'} · joined ${item.createdAt.toLocaleDateString()}` }))} />
        <AdminList title="Workspaces" rows={recentWorkspaces.map((item) => ({ key: item.id, label: item.name, meta: `${item._count.members} members · ${PLAN_LABELS[item.subscription?.plan ?? 'FREE']} plan`, href: `/w/${item.slug}` }))} />
        <AdminList title="Social connections" rows={recentAccounts.map((item) => ({ key: item.id, label: item.accountName, meta: `${item.workspace.name} · ${PLATFORM_LABELS[item.platform]} · ${ACCOUNT_STATUS_LABELS[item.status]}`, href: `/w/${item.workspace.slug}/channels?account=${item.id}` }))} />
        <AdminList title="Posts" rows={recentPosts.map((item) => ({ key: item.id, label: item.title ?? 'Untitled post', meta: `${item.workspace.name} · ${POST_STATUS_LABELS[item.status]} · ${item.createdAt.toLocaleDateString()}`, href: `/w/${item.workspace.slug}/compose/${item.id}` }))} />
      </div>
      <AdminDisclosure eyebrow="Billing" title="Subscriptions" count={subscriptions.length}>
        {subscriptions.length ? <table className="b88-table min-w-[760px]"><thead><tr><th>Workspace</th><th>Plan</th><th>Status</th><th>Renewal</th><th>Action</th></tr></thead><tbody>{subscriptions.map((item) => <tr key={item.id}><td><Link className="font-[480]" href={`/w/${item.workspace.slug}`}>{item.workspace.name}</Link></td><td>{PLAN_LABELS[item.plan]}</td><td>{SUBSCRIPTION_STATUS_LABELS[item.status]}</td><td>{item.cancelAtPeriodEnd ? `Cancels ${item.currentPeriodEnd?.toLocaleDateString() ?? 'at period end'}` : item.currentPeriodEnd?.toLocaleDateString() ?? 'No renewal date'}</td><td><Button href={`/w/${item.workspace.slug}/settings/billing`} variant="tertiary">Inspect billing</Button></td></tr>)}</tbody></table> : <EmptyState eyebrow="No subscriptions" title="No billing records" />}
      </AdminDisclosure>
      <AdminDisclosure eyebrow="Operations" title="Recent jobs" count={jobs.length}>
        {jobs.length ? <table className="b88-table min-w-[980px]"><thead><tr><th>Job</th><th>Workspace</th><th>Queue</th><th>Status</th><th>Attempts</th><th>Error</th><th>Action</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><details><summary className="cursor-pointer font-[480]">{jobTypeLabel(job.type)}</summary><div className="mt-3 max-w-md rounded-md bg-surface-soft p-3 text-xs"><p>Created {job.createdAt.toLocaleString()}</p><p className="mt-1">Scheduled {job.runAt.toLocaleString()}</p>{job.startedAt && <p className="mt-1">Started {job.startedAt.toLocaleString()}</p>}{job.completedAt && <p className="mt-1">Finished {job.completedAt.toLocaleString()}</p>}</div></details></td><td>{job.workspace ? <Link href={`/w/${job.workspace.slug}`}>{job.workspace.name}</Link> : 'Platform'}</td><td><Badge tone="outline">{queueLabel(job.queue)}</Badge></td><td>{JOB_STATUS_LABELS[job.status]}</td><td>{job.attempts}/{job.maxAttempts}</td><td className="max-w-xs whitespace-normal">{job.error ? 'The job failed. Review the private server logs for diagnostic details.' : '—'}</td><td><AdminJobActions id={job.id} status={job.status} /></td></tr>)}</tbody></table> : <EmptyState eyebrow="No jobs" title="The job queue is clear" />}
      </AdminDisclosure>
      <AdminDisclosure eyebrow="AI reporting" title="Recent AI usage" count={recentAi.length}>{recentAi.length ? <table className="b88-table min-w-[900px]"><thead><tr><th>Workspace</th><th>Operation</th><th>Provider</th><th>Model</th><th>Tokens</th><th>Estimated cost</th><th>Result</th></tr></thead><tbody>{recentAi.map((item) => <tr key={item.id}><td><Link href={`/w/${item.workspace.slug}`}>{item.workspace.name}</Link></td><td>{AI_OPERATION_LABELS[item.operation]}</td><td>{providerLabel(item.provider)}</td><td>{modelLabel(item.model)}</td><td>{item.totalTokens?.toLocaleString() ?? 'Not reported'}</td><td>{item.estimatedCost == null ? 'Not reported' : `$${Number(item.estimatedCost).toFixed(4)}`}</td><td>{item.succeeded ? 'Succeeded' : 'Failed'}</td></tr>)}</tbody></table> : <EmptyState eyebrow="No AI usage" title="No generations recorded" />}</AdminDisclosure>
      <AdminDisclosure eyebrow="Workspace usage" title="Recorded limits" count={usageRecords.length}>{usageRecords.length ? <div className="grid gap-3 sm:grid-cols-2">{usageRecords.map((item) => <Link key={item.id} href={`/w/${item.workspace.slug}/settings/billing`} className="rounded-md bg-surface-soft p-4 transition-opacity hover:opacity-80"><p className="font-[480]">{item.workspace.name}</p><p className="b88-caption mt-2">{USAGE_LABELS[item.metric] ?? 'Recorded usage'} · {item.value.toLocaleString()} · period starting {item.period.toLocaleDateString()}</p></Link>)}</div> : <p>No metered usage has been recorded.</p>}</AdminDisclosure>
      <AdminDisclosure eyebrow="Audit" title="Recent activity" count={audits.length}><table className="b88-table min-w-[700px]"><thead><tr><th>Action</th><th>User</th><th>Workspace</th><th>Created</th></tr></thead><tbody>{audits.map((item) => <tr key={item.id}><td>{auditActionLabel(item.action)}</td><td>{item.user?.email ?? 'System'}</td><td>{item.workspace?.name ?? 'Platform'}</td><td>{item.createdAt.toLocaleString()}</td></tr>)}</tbody></table></AdminDisclosure>
    </div>
  );
}

function AdminList({ title, rows }: { title: string; rows: { key: string; label: string; meta: string; href?: string }[] }) {
  return <details className="b88-card"><summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3"><span className="font-[540]">{title}</span><span className="b88-caption">{rows.length} recent · Open</span></summary><div className="mt-4">{rows.map((row) => <div key={row.key} className="border-t border-hairline-soft py-3 first:border-0">{row.href ? <Link href={row.href} className="font-[480] transition-opacity hover:opacity-80">{row.label}</Link> : <p className="font-[480]">{row.label}</p>}<p className="b88-caption mt-1">{row.meta}</p></div>)}</div></details>;
}

function AdminDisclosure({ eyebrow, title, count, children }: { eyebrow: string; title: string; count: number; children: ReactNode }) {
  return <details className="b88-card mt-6 overflow-x-auto"><summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-4"><span><span className="b88-caption block">{eyebrow}</span><span className="mt-1 block text-lg font-[540]">{title}</span></span><span className="b88-caption whitespace-nowrap">{count} recent · Open</span></summary><div className="mt-5 border-t border-hairline-soft pt-5">{children}</div></details>;
}

function queueLabel(value: string) {
  return {
    POST_PUBLISHING: 'Post publishing',
    MEDIA_PROCESSING: 'Media processing',
    THUMBNAIL_GENERATION: 'Thumbnail generation',
    ANALYTICS_SYNC: 'Analytics sync',
    NOTIFICATION: 'Notifications',
    AI_GENERATION: 'AI generation',
    RECURRENCE_EXPANSION: 'Recurrence expansion',
  }[value] ?? 'Background work';
}

function providerLabel(value: string) {
  return value.toLowerCase() === 'openai' ? 'OpenAI' : 'Simulated provider';
}

function modelLabel(value: string) {
  return {
    'mock-text-1': 'Simulated text model',
    'mock-image-1': 'Simulated image model',
    'mock-image-edit-1': 'Simulated image editor',
    'mock-video-1': 'Simulated video model',
    'mock-audio-1': 'Simulated audio model',
    'gpt-4o-mini': 'GPT-4o mini',
  }[value] ?? 'Configured provider model';
}

function jobTypeLabel(value: string) {
  return {
    'publish-post': 'Publish post',
    'process-media': 'Prepare media',
    'generate-thumbnail': 'Generate thumbnail',
    'sync-analytics': 'Update analytics',
    'send-notification-email': 'Send notification email',
    'ai-generation': 'Generate AI content',
    'expand-recurrence': 'Extend recurring schedule',
  }[value] ?? 'Background job';
}

function auditActionLabel(value: string) {
  const subject = value.split('.')[0];
  return {
    post: 'Post updated',
    campaign: 'Campaign updated',
    channel: 'Social account updated',
    approval: 'Approval updated',
    media: 'Media updated',
    workspace: 'Workspace updated',
    brand: 'Brand settings updated',
    onboarding: 'Workspace setup updated',
  }[subject] ?? 'Platform updated';
}
