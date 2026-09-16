import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workspaceFindUniqueOrThrow: vi.fn(),
  postUpdateMany: vi.fn(),
  enqueue: vi.fn(),
  addToQueue: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  db: {
    workspace: { findUniqueOrThrow: mocks.workspaceFindUniqueOrThrow },
    post: { updateMany: mocks.postUpdateMany },
  },
}));
vi.mock('@/lib/queue', () => ({ enqueue: mocks.enqueue }));
vi.mock('@/lib/scheduling/queue', () => ({ addToQueue: mocks.addToQueue }));

import { isReleaseMode, releasePost } from '@/lib/posts/release';

describe('isReleaseMode', () => {
  it.each(['now', 'queue'])('accepts %s', (value) => expect(isReleaseMode(value)).toBe(true));

  it.each([null, undefined, '', 'NOW', 'schedule', 7])('rejects %j', (value) => {
    expect(isReleaseMode(value)).toBe(false);
  });
});

describe('releasePost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceFindUniqueOrThrow.mockResolvedValue({ queuePaused: false });
    mocks.postUpdateMany.mockResolvedValue({ count: 1 });
    mocks.addToQueue.mockResolvedValue(new Date('2026-02-01T09:00:00Z'));
  });

  it('schedules an immediate release and hands it to the publishing queue', async () => {
    const at = await releasePost('workspace-1', 'post-1', 'now');

    expect(mocks.postUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SCHEDULED', scheduledAt: at } }),
    );
    // SCHEDULED, not APPROVED: the engine scans for SCHEDULED, so anything else
    // would leave the post sitting still — the exact bug this replaced.
    expect(mocks.enqueue).toHaveBeenCalledWith(
      'publish-post',
      { postId: 'post-1' },
      { workspaceId: 'workspace-1', dedupeKey: 'publish:post-1' },
    );
  });

  it('takes the next queue slot in queue mode', async () => {
    const at = await releasePost('workspace-1', 'post-1', 'queue');

    expect(mocks.addToQueue).toHaveBeenCalledWith('workspace-1', 'post-1');
    expect(at.toISOString()).toBe('2026-02-01T09:00:00.000Z');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('refuses to queue into a paused queue', async () => {
    mocks.workspaceFindUniqueOrThrow.mockResolvedValue({ queuePaused: true });

    await expect(releasePost('workspace-1', 'post-1', 'queue')).rejects.toThrow('queue is paused');
    expect(mocks.addToQueue).not.toHaveBeenCalled();
  });

  it('does not re-send a post that is already publishing', async () => {
    mocks.postUpdateMany.mockResolvedValue({ count: 0 });

    await expect(releasePost('workspace-1', 'post-1', 'now')).rejects.toThrow('already publishing');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
