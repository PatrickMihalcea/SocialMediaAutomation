import { Badge, Button, StatCard } from '@/bridge88/components';
import Link from 'next/link';
import { requirePlatformAdmin } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { cancelJobAction, retryJobAction } from '@/app/actions/admin';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { AppError } from '@/lib/errors';

function sentenceCase(value: string) {
  const words = value.replace(/[_\-.]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
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
  const [users, workspaces, accounts, posts, jobs, aiUsage, aiCost, storage, subscriptions, audits, recentUsers, recentWorkspaces, recentAccounts, recentPosts] = await Promise.all([
    db.user.count(), db.workspace.count(), db.socialAccount.count(), db.post.count(),
    db.job.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    db.aiGeneration.count(), db.aiGeneration.aggregate({ _sum: { estimatedCost: true, totalTokens: true } }),
    db.mediaAsset.aggregate({ _sum: { size: true } }),
    db.subscription.findMany({ include: { workspace: { select: { name: true } } }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    db.auditLog.findMany({ include: { user: { select: { email: true } }, workspace: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 30 }),
    db.user.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, email: true, name: true, createdAt: true, isPlatformAdmin: true } }),
    db.workspace.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { _count: { select: { members: true } } } }),
    db.socialAccount.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, accountName: true, platform: true, status: true, createdAt: true } }),
    db.post.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, title: true, status: true, createdAt: true } }),
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
        <AdminList title="Users" rows={recentUsers.map((item) => `${item.name ?? item.email} · ${item.isPlatformAdmin ? 'Platform admin' : 'User'} · ${item.createdAt.toLocaleDateString()}`)} />
        <AdminList title="Workspaces" rows={recentWorkspaces.map((item) => `${item.name} · ${item._count.members} members · ${item.createdAt.toLocaleDateString()}`)} />
        <AdminList title="Accounts" rows={recentAccounts.map((item) => `${item.accountName} · ${PLATFORM_LABELS[item.platform]} · ${sentenceCase(item.status)}`)} />
        <AdminList title="Posts" rows={recentPosts.map((item) => `${item.title ?? 'Untitled post'} · ${sentenceCase(item.status)} · ${item.createdAt.toLocaleDateString()}`)} />
      </div>
      <section className="b88-card mt-8 overflow-x-auto"><p className="b88-caption">Billing</p><h2 className="b88-heading mt-2 mb-5">Subscriptions</h2><table className="b88-table min-w-[700px]"><thead><tr><th>Workspace</th><th>Plan</th><th>Status</th><th>Period ends</th></tr></thead><tbody>{subscriptions.map((item) => <tr key={item.id}><td>{item.workspace.name}</td><td>{sentenceCase(item.plan)}</td><td>{sentenceCase(item.status)}</td><td>{item.currentPeriodEnd?.toLocaleDateString() ?? 'Not reported'}</td></tr>)}</tbody></table></section>
      <section className="b88-card mt-8 overflow-x-auto">
        <p className="b88-caption">Operations</p><h2 className="b88-heading mt-2 mb-5">Recent jobs</h2>
        {jobs.length ? <table className="b88-table min-w-[900px]"><thead><tr><th>Type</th><th>Queue</th><th>Status</th><th>Attempts</th><th>Error</th><th>Actions</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td>{sentenceCase(job.type)}</td><td><Badge tone="outline">{sentenceCase(job.queue)}</Badge></td><td>{sentenceCase(job.status)}</td><td>{job.attempts}/{job.maxAttempts}</td><td>{job.error ?? '—'}</td><td><div className="flex gap-2">{['FAILED', 'CANCELLED'].includes(job.status) && <form action={retryJobAction.bind(null, job.id)}><Button type="submit" variant="secondary">Retry</Button></form>}{['QUEUED', 'RUNNING'].includes(job.status) && <form action={cancelJobAction.bind(null, job.id)}><Button type="submit" variant="tertiary">Cancel</Button></form>}</div></td></tr>)}</tbody></table> : <p className="rounded-md bg-surface-soft p-5">No jobs.</p>}
      </section>
      <section className="b88-card mt-8 overflow-x-auto"><p className="b88-caption">Audit</p><h2 className="b88-heading mt-2 mb-5">Recent activity</h2><table className="b88-table min-w-[700px]"><thead><tr><th>Action</th><th>User</th><th>Workspace</th><th>Created</th></tr></thead><tbody>{audits.map((item) => <tr key={item.id}><td>{sentenceCase(item.action)}</td><td>{item.user?.email ?? 'System'}</td><td>{item.workspace?.name ?? 'Platform'}</td><td>{item.createdAt.toLocaleString()}</td></tr>)}</tbody></table></section>
    </main>
  );
}

function AdminList({ title, rows }: { title: string; rows: string[] }) {
  return <section className="b88-card"><p className="b88-caption">{title}</p><div className="mt-4">{rows.map((row, index) => <p key={`${row}-${index}`} className="border-t border-hairline-soft py-3 first:border-0">{row}</p>)}</div></section>;
}
