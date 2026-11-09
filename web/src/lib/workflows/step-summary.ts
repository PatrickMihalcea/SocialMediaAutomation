import { formatElapsed } from '@/lib/workflows/labels';
import { nodeProgress, progressPercent } from '@/lib/workflows/node-output';

/** What a run's step needs to describe itself, as stored. */
export interface StepRunFacts {
  nodeType: string;
  status: string;
  durationMs: number | null;
  error: string | null;
  attempt: number;
  maxAttempts: number;
  startedAt: Date | null;
  queuedAt: Date | null;
  output: unknown;
}

/** Steps that run on the Mac's local worker, so a wait is a wait for it. */
const LOCAL_TYPES = new Set(['ANIMATE_IMAGE']);

/**
 * A few short lines on what one step of one run did, for the run history.
 *
 * Status alone ("Running") says nothing anyone hovering a square wants to
 * know. These answer the next question for each state: how far along and for
 * how long, what it is waiting on, what it produced, or why it failed.
 */
export function describeStepRun(step: StepRunFacts, now = Date.now()): string[] {
  const lines: string[] = [];
  const retry = step.attempt > 1 ? `attempt ${step.attempt} of ${step.maxAttempts}` : null;

  if (step.status === 'RUNNING') {
    const progress = nodeProgress(step.output);
    const percent = progress ? progressPercent(progress, now) : null;
    const since = step.startedAt ? `${formatElapsed(now - step.startedAt.getTime())} so far` : null;
    lines.push([
      percent !== null ? `${percent}% done` : progress ? `${progress.done} of ${progress.total} done` : 'Working',
      since,
      retry,
    ].filter(Boolean).join(' · '));
  } else if (step.status === 'QUEUED') {
    const waited = step.queuedAt ? ` for ${formatElapsed(now - step.queuedAt.getTime())}` : '';
    lines.push(LOCAL_TYPES.has(step.nodeType) ? `Waiting for your Mac${waited}` : `Waiting for the worker${waited}`);
    if (retry) lines.push(retry);
  } else if (step.status === 'PENDING') {
    lines.push('Waiting for the steps before it');
  } else if (step.status === 'SUCCEEDED') {
    lines.push([step.durationMs ? `Took ${formatElapsed(step.durationMs)}` : 'Done', retry].filter(Boolean).join(' · '));
    lines.push(...producedLines(step.output));
  } else if (step.status === 'FAILED') {
    lines.push([step.durationMs ? `Failed after ${formatElapsed(step.durationMs)}` : 'Failed', retry].filter(Boolean).join(' · '));
  } else if (step.status === 'SKIPPED') {
    lines.push('Skipped: a step before it did not finish');
  } else if (step.status === 'CANCELLED') {
    lines.push('Cancelled with the run');
  }

  if (step.error && step.status !== 'SUCCEEDED') lines.push(clip(step.error, 180));
  return lines;
}

/** What a finished step produced, from the keys steps write to their output. */
function producedLines(output: unknown): string[] {
  if (typeof output !== 'object' || output === null) return [];
  const value = output as Record<string, unknown>;
  const count = (key: string) => (Array.isArray(value[key]) ? (value[key] as unknown[]).length : 0);
  const made = [
    plural(count('images'), 'picture'),
    plural(count('clips'), 'clip'),
    plural(count('videos'), 'video'),
    typeof value.video === 'string' && !count('videos') ? '1 video' : null,
    plural(count('prompts'), 'prompt'),
  ].filter(Boolean);
  const lines = made.length ? [`Made ${made.join(', ')}`] : [];

  const checks = Array.isArray(value.checks) ? (value.checks as Array<{ pass?: boolean; score?: number; attempt?: number }>) : [];
  if (checks.length) {
    const last = checks[checks.length - 1];
    const tries = checks.length > 1 ? ` after ${checks.length} tries` : '';
    lines.push(last.pass ? `Picture test passed${tries}` : `Picture test failed${tries}, best attempt used`);
  }
  if (typeof value.theme === 'string' && value.theme) lines.push(`Theme: ${clip(value.theme, 80)}`);
  if (value.post && typeof value.post === 'object') lines.push('Posted');
  return lines;
}

function plural(count: number, noun: string): string | null {
  return count ? `${count} ${noun}${count === 1 ? '' : 's'}` : null;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
