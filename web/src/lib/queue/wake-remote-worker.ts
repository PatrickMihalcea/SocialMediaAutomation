import 'server-only';
import { env } from '@/lib/env';

/**
 * Nudges the GitHub Actions worker to start now, instead of leaving it to
 * notice on its own schedule.
 *
 * `.github/workflows/worker.yml` polls every 5 minutes because that is the
 * shortest interval GitHub allows a cron trigger to run at — fine for
 * catching a scheduled post nobody is watching, and exactly what makes a
 * click on "Run workflow" feel broken: confirm the action, then wait up to 5
 * minutes for anything to visibly happen. `workflow_dispatch` is GitHub's own
 * on-demand trigger for the same workflow file, so this calls that instead of
 * inventing a second execution path — one runner image, one script, one set
 * of secrets, just two ways to start it.
 *
 * Every failure mode here is silent by design. A deployment with none of the
 * GITHUB_DISPATCH_* variables set — most local dev, and any deployment that
 * runs its own persistent worker instead — gets a no-op and nothing else; the
 * schedule is still the backstop that catches whatever this misses, so a
 * network error or an expired token degrades to "up to 5 minutes slower,"
 * never to a broken enqueue.
 */

let configuredWarned = false;
/** Collapses a burst of enqueues (a workflow fanning out several nodes at
 * once) into a single dispatch rather than one API call per job. */
let lastDispatchAt = 0;
const DEBOUNCE_MS = 15_000;

export function isWakeConfigured(): boolean {
  return Boolean(env.GITHUB_DISPATCH_TOKEN && env.GITHUB_DISPATCH_REPO);
}

/**
 * Fire-and-forget by design — call sites that enqueue work must not wait on
 * this or fail because of it. `queue().enqueue()` calls it without awaiting
 * the result.
 */
export async function wakeRemoteWorker(options: { force?: boolean } = {}): Promise<void> {
  if (!isWakeConfigured()) return;
  if (!options.force && Date.now() - lastDispatchAt < DEBOUNCE_MS) return;
  lastDispatchAt = Date.now();

  const [owner, repo] = env.GITHUB_DISPATCH_REPO.split('/');
  if (!owner || !repo) {
    if (!configuredWarned) {
      configuredWarned = true;
      console.warn('[wake-remote-worker] GITHUB_DISPATCH_REPO must be "owner/repo"; leaving the schedule as the only trigger');
    }
    return;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${env.GITHUB_DISPATCH_WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref: env.GITHUB_DISPATCH_REF }),
        // A slow or hanging call must not become a slow enqueue for whoever
        // triggered it; this is best-effort, not a step anything waits on.
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) {
      // 403 here is almost always one specific mistake, and naming it turns a
      // status code in a log nobody reads into something fixable.
      const cause =
        response.status === 403 || response.status === 401
          ? ' — the token needs Actions: read and write on the repository ("Workflows" is a different permission)'
          : '';
      console.warn(
        `[wake-remote-worker] dispatch rejected (${response.status})${cause}; the schedule will still pick this up`,
      );
    }
  } catch (error) {
    console.warn('[wake-remote-worker] dispatch failed; the 5-minute schedule will still pick this up', error);
  }
}

/**
 * Whether a worker is already up, as GitHub sees it.
 *
 * `null` when the question could not be answered — a network error, a token
 * that lost its read, a rate limit. The caller treats that as "no worker",
 * because a wasted boot costs nothing on a public repository and a missed one
 * costs a stalled run.
 *
 * Only the first page is read. Runs come back newest first, so anything still
 * going is at the top; a page of ten completed runs means nothing is up.
 */
export async function workerIsUp(): Promise<boolean | null> {
  if (!isWakeConfigured()) return null;
  const [owner, repo] = env.GITHUB_DISPATCH_REPO.split('/');
  if (!owner || !repo) return null;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${env.GITHUB_DISPATCH_WORKFLOW}/runs?per_page=10`,
      {
        headers: {
          authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        // Never cached: the whole value of this answer is that it is current.
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { workflow_runs?: Array<{ status?: string }> };
    return (body.workflow_runs ?? []).some((run) => run.status !== 'completed');
  } catch {
    return null;
  }
}

/**
 * Starts a worker if work is waiting and none is up.
 *
 * The ordinary wake happens at enqueue time, which is one fire-and-forget HTTP
 * call. That is the right shape for latency and the wrong shape for
 * reliability: lose that single call — a worker cancelled mid-pass, a deploy
 * swapping instances underneath it, a rejected token — and the job sits in the
 * queue with nobody coming for it, forever. The five-minute schedule is
 * supposed to be the backstop, but GitHub throttles cron triggers hard enough
 * that it has gone over an hour between ticks.
 *
 * So the clock asks the question the enqueue cannot: is there queued work with
 * nothing running? Any lost dispatch is then recovered on the next tick rather
 * than never, and a stall needs *every* minute to fail rather than one.
 *
 * `force` because the enqueue debounce is about collapsing a burst of fan-out
 * into one call. This is not a burst — it is the recovery path, and skipping
 * it would reinstate the hole it exists to close.
 */
export async function wakeWorkerIfIdle(queuedJobs: number): Promise<'no-work' | 'already-up' | 'woken' | 'off'> {
  if (!isWakeConfigured()) return 'off';
  if (queuedJobs === 0) return 'no-work';
  if (await workerIsUp()) return 'already-up';

  await wakeRemoteWorker({ force: true });
  return 'woken';
}
