import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: { post: { findMany } } }));

import { postIdFrom, postsForRun } from '@/lib/workflows/run-posts';

describe('postIdFrom', () => {
  it('reads the id a draft or publish step recorded', () => {
    expect(postIdFrom({ post: { id: 'post-1', status: 'DRAFT' } })).toBe('post-1');
  });

  it.each([null, 'text', {}, { post: null }, { post: {} }, { post: { id: 7 } }])(
    'returns null for %j rather than trusting untyped output',
    (output) => {
      expect(postIdFrom(output)).toBeNull();
    },
  );
});

describe('postsForRun', () => {
  beforeEach(() => findMany.mockReset());

  it('reports a pending post as awaiting approval, with the release it will perform', async () => {
    findMany.mockResolvedValue([
      { id: 'post-1', status: 'PENDING_APPROVAL', releaseOnApproval: 'queue', workflowNodeRunId: 'noderun-1' },
    ]);

    const posts = await postsForRun('workspace-1', [{ id: 'noderun-1', output: null }]);

    expect(posts.get('noderun-1')).toEqual({
      id: 'post-1',
      awaitingApproval: true,
      releaseOnApproval: 'queue',
    });
  });

  /*
   * The bug this whole lookup exists to fix: node output is frozen at the
   * instant the step finished, so a post approved ten minutes later still read
   * "Waiting for you" on the run view forever.
   */
  it('stops awaiting approval once the post has been approved', async () => {
    findMany.mockResolvedValue([
      { id: 'post-1', status: 'SCHEDULED', releaseOnApproval: 'queue', workflowNodeRunId: 'noderun-1' },
    ]);

    const posts = await postsForRun('workspace-1', [
      { id: 'noderun-1', output: { post: { id: 'post-1', awaitingApproval: true } } },
    ]);

    expect(posts.get('noderun-1')?.awaitingApproval).toBe(false);
  });

  it('still finds a post from before origin tracking, by the id in its output', async () => {
    findMany.mockResolvedValue([
      { id: 'post-old', status: 'PENDING_APPROVAL', releaseOnApproval: null, workflowNodeRunId: null },
    ]);

    const posts = await postsForRun('workspace-1', [
      { id: 'noderun-1', output: { post: { id: 'post-old' } } },
    ]);

    expect(posts.get('noderun-1')?.id).toBe('post-old');
  });

  it('leaves a step that created no post unmapped', async () => {
    findMany.mockResolvedValue([]);

    const posts = await postsForRun('workspace-1', [{ id: 'noderun-1', output: { images: ['a'] } }]);

    expect(posts.has('noderun-1')).toBe(false);
  });

  it('scopes the lookup to the workspace', async () => {
    findMany.mockResolvedValue([]);

    await postsForRun('workspace-1', [{ id: 'noderun-1', output: null }]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'workspace-1' }) }),
    );
  });
});
