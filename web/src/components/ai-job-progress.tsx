'use client';

import type { JobStatus } from '@prisma/client';
import { Tooltip } from '@/bridge88/components';

/**
 * Where a queued generation has got to.
 *
 * A single "WAITING" badge is true and useless: it cannot distinguish work
 * nobody has started from work a provider is actively rendering, and those want
 * different reactions from the person watching. The three stages below are the
 * only ones the server actually knows — status, and whether startedAt is set —
 * so that is what this shows. No fabricated percentage: a bar creeping toward
 * 90% while nothing happens is a worse lie than an honest "still queued".
 */

interface ProgressJob {
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  provider: string;
}

const STAGES = [
  {
    key: 'queued',
    label: 'Queued',
    detail: 'Saved and waiting for the background worker to pick it up.',
  },
  {
    key: 'generating',
    label: 'Generating',
    detail: 'The worker has it and is waiting on the provider. Images usually take 20–60 seconds.',
  },
  {
    key: 'saved',
    label: 'In the library',
    detail: 'The file is stored and the asset is ready to use in a post.',
  },
] as const;

/** How long a job can sit unclaimed before saying so is more useful than not. */
const SLOW_QUEUE_MS = 120_000;

/** How many stages are behind this job, and which one it is sitting in. */
function position(job: ProgressJob): { done: number; active: number } {
  if (job.status === 'FAILED' || job.status === 'CANCELLED') return { done: 0, active: -1 };
  // Completed fills every segment. Leaving the last one mid-flight — which is
  // what "the stage it reached" literally means — showed finished work as
  // still running.
  if (job.status === 'COMPLETED') return { done: STAGES.length, active: -1 };
  if (job.status === 'RUNNING' || job.startedAt) return { done: 1, active: 1 };
  return { done: 0, active: 0 };
}

export function AiJobProgress({ job, now }: { job: ProgressJob; now: number }) {
  const stopped = job.status === 'FAILED' || job.status === 'CANCELLED';
  const { done: completed, active } = position(job);
  const since = new Date(job.startedAt ?? job.createdAt).getTime();
  const waitedTooLong =
    job.status === 'QUEUED' && now - new Date(job.createdAt).getTime() > SLOW_QUEUE_MS;

  return (
    <div className="mt-3">
      <div className="flex gap-1.5" role="list" aria-label="Generation progress">
        {STAGES.map((entry, index) => {
          const done = index < completed;
          const isActive = index === active;
          return (
            <Tooltip key={entry.key} content={entry.detail} side="top">
              <span
                role="listitem"
                aria-current={isActive ? 'step' : undefined}
                // b88-shimmer is the design system's own "this is working"
                // animation. Only the stage actually in progress carries it —
                // on a finished or pending segment it would read as activity
                // that is not happening.
                className={`h-1.5 w-12 rounded-sm sm:w-16 ${isActive ? 'b88-shimmer' : ''}`}
                style={{
                  background: stopped
                    ? 'var(--block-coral)'
                    : done
                      ? 'var(--ink)'
                      : isActive
                        ? 'var(--block-lilac)'
                        : 'var(--hairline)',
                }}
              />
            </Tooltip>
          );
        })}
      </div>

      <p className="b88-caption mt-2">
        {stopped
          ? job.status === 'CANCELLED' ? 'Cancelled' : 'Stopped'
          : job.status === 'COMPLETED'
            ? STAGES[STAGES.length - 1].label
            : `${STAGES[Math.max(0, active)].label} · ${countUp(now - since)}`}
        {job.provider === 'mock' && ' · demo placeholder, not model output'}
      </p>

      {!stopped && job.status !== 'COMPLETED' && (
        <p className="mt-1 text-sm">{STAGES[Math.max(0, active)].detail}</p>
      )}

      {waitedTooLong && (
        <p className="mt-1 text-sm">
          Still unclaimed. Work is picked up by the background worker — if this does not move,
          the worker is probably not running.
        </p>
      )}
    </div>
  );
}

function countUp(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
