import type { ReleaseMode } from '@/lib/posts/release';

/**
 * Where a post came from, and what happens to it next.
 *
 * Both the approval queue and the post detail screen answer these questions,
 * and they must answer them identically — a reviewer who reads "goes out
 * immediately" in one place and "needs scheduling" in the other has learned
 * nothing. Kept free of server-only imports so it stays unit-testable.
 */

/** Prisma include fragment that loads everything describeOrigin needs. */
export const postOriginInclude = {
  workflowNodeRun: {
    select: {
      id: true,
      nodeId: true,
      nodeName: true,
      runId: true,
      run: { select: { id: true, trigger: true, workflowId: true, workflow: { select: { name: true } } } },
    },
  },
} as const;

export interface PostOriginSource {
  workflowNodeRun: {
    nodeId: string;
    nodeName: string;
    runId: string;
    run: { trigger: string; workflowId: string; workflow: { name: string } };
  } | null;
}

export interface PostOrigin {
  /** "Bedroom picker", the workflow's name. */
  workflowName: string;
  /** "Publish to YouTube", the step that made the post. */
  stepName: string;
  /** "on a schedule" / "by hand" — how that run was started. */
  triggerPhrase: string;
  /** The run this post came out of. */
  runHref: string;
  /** The step's settings on the canvas. */
  stepHref: string;
}

const TRIGGER_PHRASE: Record<string, string> = {
  MANUAL: 'started by hand',
  SCHEDULE: 'started on a schedule',
  API: 'started by an integration',
};

/**
 * Null for a post someone composed themselves, which is most of them — the
 * caller shows nothing rather than an empty "Origin" field.
 */
export function describeOrigin(slug: string, post: PostOriginSource): PostOrigin | null {
  const step = post.workflowNodeRun;
  if (!step) return null;
  return {
    workflowName: step.run.workflow.name,
    stepName: step.nodeName,
    triggerPhrase: TRIGGER_PHRASE[step.run.trigger] ?? 'started',
    runHref: `/w/${slug}/workflows/${step.run.workflowId}/runs/${step.runId}`,
    // view=steps is required, not cosmetic: the canvas only mounts on that tab.
    stepHref: `/w/${slug}/workflows/${step.run.workflowId}?view=steps&node=${encodeURIComponent(step.nodeId)}`,
  };
}

/**
 * What approving this post will actually do, in one sentence.
 *
 * The null case is the honest one and was previously the only case: approving
 * marks the post approved and stops. Nothing publishes an approved post on its
 * own, so saying so plainly is the difference between a reviewer who schedules
 * it and one who assumes it went out.
 */
export function approvalOutcome(releaseOnApproval: string | null): string {
  const mode = releaseOnApproval as ReleaseMode | null;
  if (mode === 'now') {
    // "the channels shown", not "below": this sentence appears above the
    // channel list on the approval card and below it on the post page.
    return 'Approving publishes this post to the channels shown straight away. There is no further confirmation.';
  }
  if (mode === 'queue') {
    return 'Approving puts this post in the queue, and it publishes at the next open posting time.';
  }
  return 'Approving marks this post approved but does not publish it. Nothing sends an approved post on its own — schedule it or publish it from the post itself.';
}

/** The same outcome compressed to a button-adjacent phrase. */
export function approvalOutcomeShort(releaseOnApproval: string | null): string {
  const mode = releaseOnApproval as ReleaseMode | null;
  if (mode === 'now') return 'Approve publishes it immediately';
  if (mode === 'queue') return 'Approve queues it for the next posting time';
  return 'Approve does not publish it — it still needs scheduling';
}
