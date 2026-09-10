import { Badge, Button, EmptyState, StatCard } from '@/bridge88/components';
import Link from 'next/link';
import { requirePlatformAdmin } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { AppError } from '@/lib/errors';
import { AdminJobActions } from './job-actions';

function sentenceCase(value: string) {
  const words = value.replace(/[_\-.]+/g, ' ').trim().toLowerCase();
  return (words.charAt(0).toUpperCase() + words.slice(1))
    .replace(/\bAi\b/g, 'AI')
    .replace(/\bOauth\b/g, 'OAuth')
    .replace(/\bApi\b/g, 'API');
}

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
            <p className="mt-4 max-w-2xl">Return to your workspace to manage channels, posts and team access.</p>
            <Button href="/w" className="mt-6">Open workspace</Button>
          </section>
        </main>
      );
    }
    throw error;
  }
  const [users, workspaces, accounts, posts, jobs, aiUsage, aiCost, storage, subscriptions, audits, recentUsers, recentWorkspaces, recentAccounts, recentPosts, recentAi, usageRecords] = await Promise.all([
    db.user.count(), db.workspace.count(), db.socialAccount.count(), db.post.count(),
    db.job.findMany({ include: { workspace: { select: { name: true, slug: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.aiGeneration.count(), db.aiGeneration.aggregate({ _sum: { estimatedCost: true, totalTokens: true } }),
    db.mediaAsset.aggregate({ _sum: { size: true } }),
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
    <main id="main-content" className="mx-auto max-w-[1280px] px-6 py-12 md:px-12" tabIndex={-1}>
      <Link href="/w" className="text-xl font-[540]">Bridge88</Link>
      <p className="b88-eyebrow mt-12">Platform administration</p><h1 className="b88-page-title mt-3">System health</h1>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Users" value={String(users)}/><StatCard label="Workspaces" value={String(workspaces)}/>
        <StatCard label="Social accounts" value={String(accounts)}/><StatCard label="Posts" value={String(posts)}/>
        <StatCard label="AI generations" value={String(aiUsage)}/><StatCard label="Storage" value={`${((storage._sum.size ?? 0) / 1024 / 1024).toFixed(1)} MB`}/>
        <StatCard label="AI tokens" value={(aiCost._sum.totalTokens ?? 0).toLocaleString()}/><StatCard label="AI cost" value={`$${Number(aiCost._sum.estimatedCost ?? 0).toFixed(2)}`}/>
      </div>
      <section className="b88-card mt-8"><p className="b88-caption">Health</p><h2 className="b88-heading mt-2">Runtime checks</h2><p className="mt-4">Database available · admin query completed</p></section>
      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <AdminList title="Users" rows={recentUsers.map((item) => ({ key: item.id, label: item.name ?? item.email, meta: `${item.email} · ${item.isPlatformAdmin ? 'Platform admin' : 'User'} · joined ${item.createdAt.toLocaleDateString()}` }))} />
        <AdminList title="Workspaces" rows={recentWorkspaces.map((item) => ({ key: item.id, label: item.name, meta: `${item._count.members} members · ${sentenceCase(item.subscription?.plan ?? 'FREE')} plan`, href: `/w/${item.slug}` }))} />
        <AdminList title="Social connections" rows={recentAccounts.map((item) => ({ key: item.id, label: item.accountName, meta: `${item.workspace.name} · ${PLATFORM_LABELS[item.platform]} · ${sentenceCase(item.status)}`, href: `/w/${item.workspace.slug}/channels?account=${item.id}` }))} />
        <AdminList title="Posts" rows={recentPosts.map((item) => ({ key: item.id, label: item.title ?? 'Untitled post', meta: `${item.workspace.name} · ${sentenceCase(item.status)} · ${item.createdAt.toLocaleDateString()}`, href: `/w/${item.workspace.slug}/compose/${item.id}` }))} />
      </div>
      <section className="b88-card mt-8 overflow-x-auto"><p className="b88-caption">Billing</p><h2 className="b88-heading mt-2 mb-5">Subscriptions</h2>{subscriptions.length ? <table className="b88-table min-w-[760px]"><thead><tr><th>Workspace</th><th>Plan</th><th>Status</th><th>Renewal</th><th>Action</th></tr></thead><tbody>{subscriptions.map((item) => <tr key={item.id}><td><Link className="font-[480]" href={`/w/${item.workspace.slug}`}>{item.workspace.name}</Link></td><td>{sentenceCase(item.plan)}</td><td>{sentenceCase(item.status)}</td><td>{item.cancelAtPeriodEnd ? `Cancels ${item.currentPeriodEnd?.toLocaleDateString() ?? 'at period end'}` : item.currentPeriodEnd?.toLocaleDateString() ?? 'No renewal date'}</td><td><Button href={`/w/${item.workspace.slug}/settings/billing`} variant="tertiary">Inspect billing</Button></td></tr>)}</tbody></table> : <EmptyState eyebrow="No subscriptions" title="No billing records">Subscriptions appear after a workspace starts a paid plan.</EmptyState>}</section>
      <section className="b88-card mt-8 overflow-x-auto">
        <p className="b88-caption">Operations</p><h2 className="b88-heading mt-2 mb-5">Recent jobs</h2>
        {jobs.length ? <table className="b88-table min-w-[980px]"><thead><tr><th>Job</th><th>Workspace</th><th>Queue</th><th>Status</th><th>Attempts</th><th>Error</th><th>Action</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><details><summary className="cursor-pointer font-[480]">{sentenceCase(job.type)}</summary><div className="mt-3 max-w-md rounded-md bg-surface-soft p-3 text-xs"><p>Created {job.createdAt.toLocaleString()}</p><p className="mt-1">Scheduled {job.runAt.toLocaleString()}</p>{job.startedAt && <p className="mt-1">Started {job.startedAt.toLocaleString()}</p>}{job.completedAt && <p className="mt-1">Finished {job.completedAt.toLocaleString()}</p>}<p className="mt-1">{job.result ? 'A result was recorded.' : 'No result was recorded.'}</p></div></details></td><td>{job.workspace ? <Link href={`/w/${job.workspace.slug}`}>{job.workspace.name}</Link> : 'Platform'}</td><td><Badge tone="outline">{queueLabel(job.queue)}</Badge></td><td>{sentenceCase(job.status)}</td><td>{job.attempts}/{job.maxAttempts}</td><td className="max-w-xs whitespace-normal">{job.error ?? '—'}</td><td><AdminJobActions id={job.id} status={job.status} /></td></tr>)}</tbody></table> : <EmptyState eyebrow="No jobs" title="The job queue is clear">Publishing, analytics and AI jobs appear here when work is queued.</EmptyState>}
      </section>
      <section className="b88-card mt-8 overflow-x-auto"><p className="b88-caption">AI reporting</p><h2 className="b88-heading mt-2 mb-5">Recent AI usage</h2>{recentAi.length ? <table className="b88-table min-w-[900px]"><thead><tr><th>Workspace</th><th>Operation</th><th>Provider</th><th>Model</th><th>Tokens</th><th>Estimated cost</th><th>Result</th></tr></thead><tbody>{recentAi.map((item) => <tr key={item.id}><td><Link href={`/w/${item.workspace.slug}`}>{item.workspace.name}</Link></td><td>{sentenceCase(item.operation)}</td><td>{providerLabel(item.provider)}</td><td>{item.model}</td><td>{item.totalTokens?.toLocaleString() ?? 'Not reported'}</td><td>{item.estimatedCost == null ? 'Not reported' : `$${Number(item.estimatedCost).toFixed(4)}`}</td><td>{item.succeeded ? 'Succeeded' : 'Failed'}</td></tr>)}</tbody></table> : <EmptyState eyebrow="No AI usage" title="No generations recorded">AI requests appear here with their model, provider, operation, token count and estimated cost.</EmptyState>}</section>
      <section className="b88-card mt-8"><p className="b88-caption">Workspace usage</p><h2 className="b88-heading mt-2">Recorded limits</h2>{usageRecords.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{usageRecords.map((item) => <Link key={item.id} href={`/w/${item.workspace.slug}/settings/billing`} className="rounded-md bg-surface-soft p-4 transition-opacity hover:opacity-80"><p className="font-[480]">{item.workspace.name}</p><p className="b88-caption mt-2">{sentenceCase(item.metric)} · {item.value.toLocaleString()} · period starting {item.period.toLocaleDateString()}</p></Link>)}</div> : <p className="mt-4">No metered usage has been recorded.</p>}</section>
      <section className="b88-card mt-8 overflow-x-auto"><p className="b88-caption">Audit</p><h2 className="b88-heading mt-2 mb-5">Recent activity</h2><table className="b88-table min-w-[700px]"><thead><tr><th>Action</th><th>User</th><th>Workspace</th><th>Created</th></tr></thead><tbody>{audits.map((item) => <tr key={item.id}><td>{sentenceCase(item.action)}</td><td>{item.user?.email ?? 'System'}</td><td>{item.workspace?.name ?? 'Platform'}</td><td>{item.createdAt.toLocaleString()}</td></tr>)}</tbody></table></section>
    </main>
  );
}

function AdminList({ title, rows }: { title: string; rows: { key: string; label: string; meta: string; href?: string }[] }) {
  return <section className="b88-card"><p className="b88-caption">{title}</p><div className="mt-4">{rows.map((row) => <div key={row.key} className="border-t border-hairline-soft py-3 first:border-0">{row.href ? <Link href={row.href} className="font-[480] transition-opacity hover:opacity-80">{row.label}</Link> : <p className="font-[480]">{row.label}</p>}<p className="b88-caption mt-1">{row.meta}</p></div>)}</div></section>;
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
  }[value] ?? sentenceCase(value);
}

function providerLabel(value: string) {
  return value.toLowerCase() === 'openai' ? 'OpenAI' : sentenceCase(value);
}
