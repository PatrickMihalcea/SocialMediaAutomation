import { describe, expect, it } from 'vitest';
import { approvalOutcome, approvalOutcomeShort, describeOrigin } from '@/lib/posts/origin';

const workflowPost = {
  workflowNodeRun: {
    nodeId: 'node-7',
    nodeName: 'Publish to YouTube',
    runId: 'run-3',
    run: { trigger: 'SCHEDULE', workflowId: 'wf-1', workflow: { name: 'Treehouses' } },
  },
};

describe('describeOrigin', () => {
  it('names the workflow, the step and how the run was started', () => {
    const origin = describeOrigin('northwind-studio', workflowPost);

    expect(origin).toMatchObject({
      workflowName: 'Treehouses',
      stepName: 'Publish to YouTube',
      triggerPhrase: 'started on a schedule',
      runHref: '/w/northwind-studio/workflows/wf-1/runs/run-3',
    });
  });

  it('links the step to the canvas tab that actually mounts it', () => {
    // Without view=steps the link lands on Runs and the node selection has
    // nothing to select — the canvas only mounts on that tab.
    expect(describeOrigin('northwind-studio', workflowPost)?.stepHref).toBe(
      '/w/northwind-studio/workflows/wf-1?view=steps&node=node-7',
    );
  });

  it('returns nothing for a post someone composed themselves', () => {
    expect(describeOrigin('northwind-studio', { workflowNodeRun: null })).toBeNull();
  });

  it('falls back to a neutral phrase for a trigger it does not know', () => {
    const origin = describeOrigin('northwind-studio', {
      workflowNodeRun: { ...workflowPost.workflowNodeRun, run: { ...workflowPost.workflowNodeRun.run, trigger: 'WEBHOOK' } },
    });

    expect(origin?.triggerPhrase).toBe('started');
  });
});

describe('approvalOutcome', () => {
  it('warns that approving publishes immediately', () => {
    expect(approvalOutcome('now')).toContain('straight away');
    expect(approvalOutcomeShort('now')).toBe('Approve publishes it immediately');
  });

  it('says the queue takes it at the next posting time', () => {
    expect(approvalOutcome('queue')).toContain('next open posting time');
  });

  /*
   * The null case is the one that matters most. Nothing publishes an APPROVED
   * post — the engine scans for SCHEDULED — so the copy must not imply that
   * approving sends it. This test exists to stop that sentence drifting back.
   */
  it('states plainly that approving alone does not publish', () => {
    const sentence = approvalOutcome(null);

    expect(sentence).toContain('does not publish it');
    expect(sentence).not.toMatch(/\bqueue takes it\b/);
    expect(approvalOutcomeShort(null)).toContain('still needs scheduling');
  });
});
