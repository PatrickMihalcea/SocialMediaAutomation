import { describe, expect, it, vi } from 'vitest';
import { WorkflowRunTrigger } from '@prisma/client';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  workflowFindFirst: vi.fn(),
  workflowNodeRunUpdateMany: vi.fn(),
  workflowNodeRunUpdate: vi.fn(),
  workflowNodeRunFindUnique: vi.fn(),
  workflowNodeRunGroupBy: vi.fn(),
  workflowRunFindUnique: vi.fn(),
  workflowRunUpdateMany: vi.fn(),
  getExecutor: vi.fn(),
  workflowRunCreate: vi.fn(),
  workflowNodeRunCreateMany: vi.fn(),
  workflowUpdate: vi.fn(),
  workflowNodeRunFindMany: vi.fn(),
  enqueue: vi.fn(),
  audit: vi.fn(),
  jobUpdateMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    workflow: { findFirst: mocks.workflowFindFirst, update: mocks.workflowUpdate },
    workflowNodeRun: {
      createMany: mocks.workflowNodeRunCreateMany,
      findMany: mocks.workflowNodeRunFindMany,
      updateMany: mocks.workflowNodeRunUpdateMany,
      update: mocks.workflowNodeRunUpdate,
      findUnique: mocks.workflowNodeRunFindUnique,
      groupBy: mocks.workflowNodeRunGroupBy,
    },
    workflowRun: {
      create: mocks.workflowRunCreate,
      findUnique: mocks.workflowRunFindUnique,
      updateMany: mocks.workflowRunUpdateMany,
    },
    job: { updateMany: mocks.jobUpdateMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        workflowRun: {
          create: mocks.workflowRunCreate,
          updateMany: mocks.workflowRunUpdateMany,
        },
        workflowNodeRun: {
          createMany: mocks.workflowNodeRunCreateMany,
          findMany: mocks.workflowNodeRunFindMany,
          updateMany: mocks.workflowNodeRunUpdateMany,
        },
        workflow: { update: mocks.workflowUpdate },
        job: { updateMany: mocks.jobUpdateMany },
      }),
    ),
  },
}));
vi.mock('@/lib/queue', () => ({ enqueue: mocks.enqueue }));
vi.mock('@/lib/workflows/executors', () => ({ getExecutor: mocks.getExecutor }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));

import { cancelWorkflowRun, runWorkflowNode, startWorkflowRun } from '@/lib/workflows/engine';

describe('startWorkflowRun', () => {
  it('blocks runs when a publish step has no channels selected', async () => {
    mocks.workflowFindFirst.mockResolvedValue({
      id: 'workflow-1',
      createdById: 'user-1',
      nodes: [
        {
          id: 'node-1',
          type: 'PUBLISH',
          name: 'Send to channels',
          config: { socialAccountIds: [], caption: '', mode: 'queue', requireApproval: true },
          version: 1,
          positionX: 0,
          positionY: 0,
        },
      ],
      edges: [],
    });

    await expect(
      startWorkflowRun({
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow(/needs at least one channel selected/);

    expect(mocks.workflowRunCreate).not.toHaveBeenCalled();
  });

  it.each([
    [{ enabled: false, archivedAt: new Date() }, /restore this workflow/i],
    [{ enabled: true, archivedAt: new Date() }, /restore this workflow/i],
  ])('blocks archived workflows whatever their pause state', async (state, message) => {
    vi.clearAllMocks();
    mocks.workflowFindFirst.mockResolvedValue({
      id: 'workflow-1',
      createdById: 'user-1',
      nodes: [{ id: 'node-1' }],
      edges: [],
      ...state,
    });

    await expect(startWorkflowRun({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })).rejects.toThrow(message);
    expect(mocks.workflowRunCreate).not.toHaveBeenCalled();
  });

  // Pausing exists to stop unattended work. Someone editing a paused duplicate
  // still needs Run now to see what their edits produce.
  it('keeps a paused workflow runnable by hand but not on its schedule', async () => {
    vi.clearAllMocks();
    mocks.workflowFindFirst.mockResolvedValue({
      id: 'workflow-1',
      createdById: 'user-1',
      enabled: false,
      archivedAt: null,
      nodes: [{
        id: 'node-1',
        type: 'IDEA_GENERATOR',
        name: 'Room ideas',
        config: { mode: 'image', theme: 'treehouses', count: 5, styleSuffix: '' },
        version: 1,
        positionX: 0,
        positionY: 0,
      }],
      edges: [],
    });

    await expect(startWorkflowRun({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      trigger: WorkflowRunTrigger.SCHEDULE,
    })).rejects.toThrow(/resume this workflow before it can run on its schedule/i);
    expect(mocks.workflowRunCreate).not.toHaveBeenCalled();

    mocks.workflowRunCreate.mockResolvedValue({ id: 'run-1' });
    mocks.workflowNodeRunFindMany.mockResolvedValue([]);
    await startWorkflowRun({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    });
    expect(mocks.workflowRunCreate).toHaveBeenCalled();
  });
});

describe('runWorkflowNode retry dispatch', () => {
  /**
   * A step that fails retryably reschedules itself from inside the job that is
   * currently failing — so at that moment the original job is still RUNNING and
   * still holds its dedupe key.
   *
   * Keying a dispatch on the node run alone made storeJob dedupe the retry
   * against that in-flight job and return it instead of creating one. The step
   * was left QUEUED with no job behind it and the run hung indefinitely, because
   * the only recovery is a sweeper that runs in the worker.
   */
  it('gives the retry a key that cannot collide with the job it is failing inside', async () => {
    vi.clearAllMocks();

    const snapshot = {
      version: 1,
      nodes: [{ id: 'node-1', type: 'CREATE_DRAFT', name: 'Leave a draft', config: {}, version: 1, positionX: 0, positionY: 0 }],
      edges: [],
    };

    // The claim into RUNNING succeeds.
    mocks.workflowNodeRunUpdateMany.mockResolvedValue({ count: 1 });
    mocks.workflowNodeRunUpdate.mockResolvedValue({});
    mocks.workflowNodeRunFindUnique.mockResolvedValue({
      id: 'noderun-1',
      workspaceId: 'workspace-1',
      runId: 'run-1',
      nodeId: 'node-1',
      nodeType: 'CREATE_DRAFT',
      nodeName: 'Leave a draft',
      config: {},
      status: 'RUNNING',
      // First attempt of three, so this failure reschedules rather than gives up.
      attempt: 1,
      maxAttempts: 3,
      startedAt: new Date(),
      output: null,
      run: {
        id: 'run-1',
        workspaceId: 'workspace-1',
        graph: snapshot,
        triggeredById: 'user-1',
        cancelledAt: null,
        workflow: { name: 'Bedroom picker' },
      },
    });
    mocks.workflowRunFindUnique.mockResolvedValue({ id: 'run-1', graph: snapshot, cancelledAt: null });
    mocks.workflowNodeRunGroupBy.mockResolvedValue([{ status: 'QUEUED', _count: { _all: 1 } }]);

    // A transient failure, exactly like a dev-server chunk load error.
    mocks.getExecutor.mockResolvedValue(async () => {
      throw new Error('Failed to load chunk server/chunks/[root-of-the-server]__51873c56._.js');
    });

    await runWorkflowNode('noderun-1');

    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    const [type, payload, options] = mocks.enqueue.mock.calls[0];
    expect(type).toBe('run-workflow-node');
    expect(payload).toEqual({ nodeRunId: 'noderun-1' });
    // The key must name this attempt, not just the node run.
    expect(options.dedupeKey).toBe('workflow-node:noderun-1:2');
    expect(options.dedupeKey).not.toBe('workflow-node:noderun-1');
    // And it must be scheduled, not dropped.
    expect(options.runAt).toBeInstanceOf(Date);
  });
});

describe('cancelWorkflowRun', () => {
  it('cancels queued transport jobs by their stored job ids', async () => {
    vi.clearAllMocks();
    mocks.workflowRunUpdateMany.mockResolvedValue({ count: 1 });
    mocks.workflowNodeRunFindMany.mockResolvedValue([
      { id: 'node-run-1', jobId: 'job-1' },
      { id: 'node-run-2', jobId: 'job-2' },
    ]);
    mocks.workflowNodeRunUpdateMany.mockResolvedValue({ count: 2 });
    mocks.jobUpdateMany.mockResolvedValue({ count: 2 });

    await cancelWorkflowRun('run-1', 'workspace-1');

    expect(mocks.jobUpdateMany).toHaveBeenCalledWith({
      where: {
        queue: 'WORKFLOW',
        status: 'QUEUED',
        id: { in: ['job-1', 'job-2'] },
      },
      data: { status: 'CANCELLED', dedupeKey: null, completedAt: expect.any(Date) },
    });
  });
});
