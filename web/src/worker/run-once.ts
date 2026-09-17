import { db } from '@/lib/db';
import { scanDuePosts } from '@/lib/publishing/engine';
import { runCoarseUpkeep } from '@/lib/scheduling/coarse';
import { scanDueWorkflows } from '@/lib/workflows/schedule';
import { sweepWorkflowRuns } from '@/lib/workflows/engine';
import { runJob } from '@/lib/queue/runner';
import { persistCodexAuth, restoreCodexAuth } from '@/lib/ai/codex-auth';
import { JobStatus } from '@prisma/client';

/**
 * One pass of due work, then exit. `src/worker/index.ts` is a daemon that
 * loops forever with setInterval — the right shape for a process someone
 * keeps running, wrong for a scheduler that starts a fresh VM, runs a job, and
 * throws the machine away. This is that second shape, meant to be invoked on a
 * cron — a GitHub Actions schedule, in particular, which needs no persistent
 * host and so needs no host to keep paying for or keeping switched on.
 *
 * Scope is deliberately narrower than the daemon: analytics sync (every 6h)
 * and recurrence expansion (daily) are omitted. Both are safe to call more
 * often than intended — dedupeKey is cleared on terminal state, so a repeat
 * call just enqueues the next occurrence rather than erroring — but calling
 * them every 5–15 minutes instead of every 6–24 hours changes their cadence
 * outright, hammering whatever they call far more than intended. Add them
 * back gated by a coarse time check (only fire in a specific hour, or track a
 * last-run marker) if you need them running unattended too; due posts and due
 * workflows do not have that problem, since a scan that finds nothing due
 * costs one cheap query and returns.
 */

/**
 * Wall-clock budget for draining the queue, distinct from RENDER_TIMEOUT_MS
 * (which bounds one ffmpeg process). This bounds the whole batch, so a slow
 * render cannot run past the next scheduled invocation and collide with it —
 * two GitHub Actions runs claiming the same job is harmless (the runner claims
 * rows conditionally) but wastes a second VM's minutes for nothing.
 */
const DEFAULT_BUDGET_MS = 4 * 60 * 1000;
const CONCURRENCY = 4;
const POLL_INTERVAL_MS = 3000;

async function main() {
  const budgetMs = Number(process.env.RUN_ONCE_BUDGET_MS) || DEFAULT_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const inFlight = new Set<string>();

  console.log(`[run-once] starting, budget ${Math.round(budgetMs / 1000)}s`);

  // Before any work, because an image job is what needs it — and never fatal.
  // This pass also publishes due posts and renders video, none of which care
  // about an image credential, so a broken one degrades image generation
  // rather than stopping everything else. The jobs that need it fail with the
  // provider's own error, which says what is missing.
  const restored = await restoreCodexAuth().catch((error: unknown) => {
    // Loud, and never a fallback to a provider that costs money. Image jobs
    // fail with this same text; posting and rendering carry on regardless.
    console.error(
      `[run-once] IMAGE GENERATION PAUSED — ${error instanceof Error ? error.message : String(error)}`,
    );
    return 'failed' as const;
  });
  if (restored !== 'disabled') console.log(`[run-once] codex credential restored from ${restored}`);

  // Recurrence and analytics ride a much slower schedule of their own, set by
  // whichever workflow started this pass. Repeating them is safe; repeating
  // them every five minutes would hammer the platform APIs, which is why they
  // are opt-in rather than part of every tick.
  if (process.env.RUN_ONCE_COARSE === '1') {
    const { expanded, analytics } = await runCoarseUpkeep();
    console.log(`[run-once] coarse upkeep — recurrences expanded ${expanded}, analytics queued for ${analytics} workspace(s)`);
  }

  await scanDuePosts();
  const { started } = await scanDueWorkflows();
  const { requeued, settled } = await sweepWorkflowRuns();
  console.log(`[run-once] scans done — workflows started ${started}, requeued ${requeued}, settled ${settled}`);

  let processed = 0;
  while (Date.now() < deadline) {
    const capacity = CONCURRENCY - inFlight.size;
    if (capacity > 0) {
      const due = await db.job.findMany({
        where: { status: JobStatus.QUEUED, runAt: { lte: new Date() } },
        orderBy: { runAt: 'asc' },
        take: capacity,
        select: { id: true },
      });
      for (const job of due) {
        if (inFlight.has(job.id)) continue;
        inFlight.add(job.id);
        processed += 1;
        void runJob(job.id)
          .catch((error) => console.error('[run-once] job failed outside the runner', job.id, error))
          .finally(() => inFlight.delete(job.id));
      }
      // Nothing queued and nothing running: the batch is caught up, and
      // sitting in the poll loop until the budget expires would only waste
      // Actions minutes for no reason.
      if (due.length === 0 && inFlight.size === 0) break;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // A job still running at the deadline is left to finish on its own —
  // runJob is not cancelled here — but the process stops waiting for it and
  // reports honestly rather than claiming a clean drain that did not happen.
  if (inFlight.size > 0) {
    console.log(`[run-once] budget exhausted with ${inFlight.size} job(s) still in flight; the next scheduled run will pick up anything left`);
  }
  console.log(`[run-once] done — claimed ${processed} job(s)`);
}

/**
 * Runs whether the pass succeeded or not: a refresh that happened before the
 * failure is still the token the next run needs, and dropping it is how a
 * working setup quietly stops working a fortnight later.
 */
async function persistCredential() {
  try {
    const persisted = await persistCodexAuth();
    if (persisted === 'saved') console.log('[run-once] codex credential was refreshed; stored the new one');
  } catch (error) {
    console.error('[run-once] could not store the refreshed codex credential', error);
  }
}

main()
  .catch((error) => {
    console.error('[run-once] failed', error);
    process.exitCode = 1;
  })
  .finally(persistCredential)
  .finally(() => db.$disconnect());
