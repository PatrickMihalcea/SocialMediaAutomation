import { db } from '@/lib/db';
import { scanDuePosts } from '@/lib/publishing/engine';
import { runCoarseUpkeep } from '@/lib/scheduling/coarse';
import { scanDueWorkflows } from '@/lib/workflows/schedule';
import { sweepWorkflowRuns } from '@/lib/workflows/engine';
import { runJob } from '@/lib/queue/runner';
import { reclaimStaleJobs } from '@/lib/queue/store';
import { persistCodexAuth, restoreCodexAuth } from '@/lib/ai/codex-auth';
import { writeFile } from 'node:fs/promises';
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
/**
 * Budget kept back for work already started, during which no new job is taken.
 *
 * Claiming right up to the deadline is how a long step never finishes. A
 * render takes a couple of minutes and nothing about it resumes: claimed with
 * one minute left it is abandoned, reclaimed by the next pass, started again
 * from the beginning, and if that pass is also near its end, abandoned again.
 * The step stays QUEUED for ever while the work is done over and over.
 *
 * So the last stretch of a pass finishes what it holds rather than taking on
 * more. A job left for the next pass costs one tick; a job restarted from zero
 * every pass costs everything and never lands.
 */
const CLAIM_CUTOFF_MS = 3 * 60 * 1000;
/**
 * How far ahead a retry may be and still be worth holding the VM for.
 *
 * Covers the whole backoff ladder (10s, 20s, 40s, 80s) with room to spare, and
 * stops well short of the five-minute cron interval — anything further out is
 * cheaper to leave for the next tick than to keep a runner idling through.
 */
const RETRY_WAIT_MS = 2 * 60 * 1000;
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

  // First, because the two scans below both decide what to do from job rows.
  //
  // A pass that is killed — the runner's own timeout, or this process exiting
  // with work still in flight, which it does by design — leaves jobs RUNNING
  // with nothing behind them. Nothing moves those again on its own, and a step
  // whose job is RUNNING looks busy to the sweeper, so it sits QUEUED for good
  // while the run that owns it never finishes. The long-lived driver has always
  // reclaimed these on start-up; this worker never starts that driver.
  const reclaimed = await reclaimStaleJobs().catch((error: unknown) => {
    console.error('[run-once] could not reclaim stale jobs', error);
    return 0;
  });
  if (reclaimed > 0) console.log(`[run-once] reclaimed ${reclaimed} job(s) abandoned by an earlier pass`);

  await scanDuePosts();
  const { started } = await scanDueWorkflows();
  const { requeued, settled } = await sweepWorkflowRuns();
  console.log(`[run-once] scans done — workflows started ${started}, requeued ${requeued}, settled ${settled}`);

  let processed = 0;
  let announcedWait = false;
  let announcedCutoff = false;
  while (Date.now() < deadline) {
    const takingWork = Date.now() < deadline - CLAIM_CUTOFF_MS;
    if (!takingWork && inFlight.size === 0) break;
    if (!takingWork && !announcedCutoff) {
      announcedCutoff = true;
      console.log(
        `[run-once] no longer claiming work; finishing the ${inFlight.size} job(s) already started`,
      );
    }
    const capacity = takingWork ? CONCURRENCY - inFlight.size : 0;
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
      // Nothing due and nothing running. Before giving up the VM, look for a
      // retry about to come round — but only just round the corner.
      //
      // A failed step is retried on a short backoff: ten seconds, then twenty,
      // then forty, then eighty. Exiting the instant nothing is due left every
      // one of those waiting for the next cron tick five minutes later, so
      // four retries of one flaky image became twenty minutes of wall clock on
      // a machine that was already up and idle.
      //
      // The window is the backoffs and nothing more. Waiting out the whole
      // budget instead was a mistake worth naming: this job holds a
      // concurrency group of one, so a pass that sits for ten minutes swallows
      // the five-minute ticks queued behind it — GitHub keeps a single pending
      // run per group and drops the rest. Trying to save one tick cost two.
      if (due.length === 0 && inFlight.size === 0) {
        const horizon = Math.min(Date.now() + RETRY_WAIT_MS, deadline);
        const waiting = await db.job.findFirst({
          where: { status: JobStatus.QUEUED, runAt: { lte: new Date(horizon) } },
          orderBy: { runAt: 'asc' },
          select: { runAt: true },
        });
        if (!waiting) break;
        // Once, not on every poll: this loop turns over every three seconds.
        if (!announcedWait) {
          announcedWait = true;
          console.log(
            `[run-once] holding for ${Math.max(0, Math.round((waiting.runAt.getTime() - Date.now()) / 1000))}s`
            + ' to run a retry in this pass',
          );
        }
      }
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

  // Whether to start another pass straight away.
  //
  // The schedule is not what keeps this alive — it cannot be. GitHub treats a
  // cron as best effort and delivers a fraction of what is asked for: a run
  // whose work takes ten minutes was finishing in four hours, nearly all of it
  // a finished step waiting for the next pass to exist.
  //
  // So a pass that leaves work behind asks for its successor. The chain runs
  // only while there is something to do and stops the moment there is not, so
  // an idle account spends nothing and a busy one keeps moving instead of
  // waiting ninety minutes for GitHub to feel like it.
  await signalRemainingWork(inFlight.size);

  // Stop now rather than waiting for whatever is still running.
  //
  // Without this the process lingers until every in-flight promise settles —
  // a seven-minute upload held a pass whose budget was eight minutes well past
  // the runner's twelve-minute ceiling, and the job was killed. A killed job
  // is the worst ending available: its work is abandoned either way, and the
  // chaining step may not get to run at all, so nothing starts the pass that
  // would have picked the work back up.
  //
  // Leaving on our own terms is safe because abandoned jobs are reclaimed at
  // the start of the next pass, and the line above has already asked for one.
  process.exit(0);
}

/**
 * Writes the marker the workflow reads to decide whether to chain another pass.
 *
 * A file rather than an exit code: this process exiting non-zero would mark the
 * job failed, and "there is more to do" is not a failure.
 */
async function signalRemainingWork(inFlight: number): Promise<void> {
  const marker = process.env.RUN_ONCE_CONTINUE_FILE;
  if (!marker) return;
  try {
    // Queued work, and work this pass is about to walk away from.
    //
    // Counting only QUEUED was wrong in the one case that matters most: a pass
    // that runs out of budget mid-job holds that job in RUNNING, so the queue
    // reads as empty, no successor is asked for, and the work sits abandoned
    // until something else happens along. The jobs still running here are
    // exactly the ones the next pass will reclaim — so they are the strongest
    // reason to start one.
    const queued = await db.job.count({
      where: {
        status: JobStatus.QUEUED,
        // Anything already due, plus anything about to be: a retry a few
        // seconds out should not wait for the next cron tick.
        runAt: { lte: new Date(Date.now() + 2 * 60 * 1000) },
      },
    });
    const abandoned = await db.job.count({ where: { status: JobStatus.RUNNING } });
    const remaining = queued + Math.max(inFlight, abandoned);
    if (remaining === 0) {
      console.log('[run-once] queue is empty and nothing was left running; nothing to chain');
      return;
    }
    console.log(
      `[run-once] ${queued} queued and ${inFlight} left running; asking for another pass`,
    );
    await writeFile(marker, String(remaining), 'utf8');
  } catch (error) {
    // Never fails the pass: the schedule is still the backstop.
    console.error('[run-once] could not check for remaining work', error);
  }
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
