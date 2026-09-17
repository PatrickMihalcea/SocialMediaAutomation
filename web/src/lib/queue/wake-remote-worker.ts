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
export async function wakeRemoteWorker(): Promise<void> {
  if (!isWakeConfigured()) return;
  if (Date.now() - lastDispatchAt < DEBOUNCE_MS) return;
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
