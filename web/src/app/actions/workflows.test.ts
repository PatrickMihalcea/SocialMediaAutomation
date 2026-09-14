import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireWorkspace: vi.fn(),
  edgeFindFirst: vi.fn(),
  edgeDelete: vi.fn(),
  nodeFindFirst: vi.fn(),
  nodeUpdate: vi.fn(),
  workflowFindFirst: vi.fn(),
  workflowUpdate: vi.fn(),
  workflowCreate: vi.fn(),
  workflowDelete: vi.fn(),
  workflowRunCount: vi.fn(),
  nodeCreateMany: vi.fn(),
  edgeCreateMany: vi.fn(),
  mediaFolderFindMany: vi.fn(),
  mediaAssetFindMany: vi.fn(),
  mediaAssetFindFirst: vi.fn(),
  signedUrl: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({
  requireWorkspace: mocks.requireWorkspace,
}));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('@/lib/db', () => ({
  db: {
    workflowEdge: {
      findFirst: mocks.edgeFindFirst,
      delete: mocks.edgeDelete,
    },
    workflowNode: {
      findFirst: mocks.nodeFindFirst,
      update: mocks.nodeUpdate,
      createMany: mocks.nodeCreateMany,
    },
    workflow: {
      findFirst: mocks.workflowFindFirst,
      update: mocks.workflowUpdate,
      create: mocks.workflowCreate,
      delete: mocks.workflowDelete,
    },
    workflowRun: { count: mocks.workflowRunCount },
    mediaFolder: { findMany: mocks.mediaFolderFindMany },
    mediaAsset: {
      findMany: mocks.mediaAssetFindMany,
      findFirst: mocks.mediaAssetFindFirst,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/storage', () => ({
  storage: () => ({ signedUrl: mocks.signedUrl }),
}));

import {
  deleteWorkflowAction,
  disconnectAction,
  duplicateWorkflowAction,
  getWorkflowTrimPreviewAction,
  setWorkflowArchivedAction,
  updateNodeAction,
  updateWorkflowAction,
} from '@/app/actions/workflows';
import { AppError } from '@/lib/errors';

describe('disconnectAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspace.mockResolvedValue({
      workspace: { id: 'workspace-1' },
      user: { id: 'user-1' },
    });
  });

  it('deletes the edge when it belongs to the workspace', async () => {
    mocks.edgeFindFirst.mockResolvedValue({ id: 'edge-1', workflowId: 'workflow-1' });
    mocks.edgeDelete.mockResolvedValue({ id: 'edge-1' });

    await disconnectAction('demo', 'edge-1');

    expect(mocks.requireWorkspace).toHaveBeenCalledWith('demo', 'workflow:edit');
    expect(mocks.edgeDelete).toHaveBeenCalledWith({ where: { id: 'edge-1' } });
  });

  it('throws when the edge no longer exists', async () => {
    mocks.edgeFindFirst.mockResolvedValue(null);

    await expect(disconnectAction('demo', 'missing-edge')).rejects.toThrow(
      'That connection no longer exists.',
    );
    expect(mocks.edgeDelete).not.toHaveBeenCalled();
  });
});

describe('updateWorkflowAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspace.mockResolvedValue({
      workspace: { id: 'workspace-1', timezone: 'Europe/Bucharest' },
      user: { id: 'user-1' },
    });
    mocks.workflowFindFirst.mockResolvedValue({
      id: 'workflow-1',
      workspaceId: 'workspace-1',
      enabled: true,
      archivedAt: null,
      scheduleEnabled: true,
      scheduleWeekdays: [1],
      scheduleHour: 9,
      scheduleMinute: 0,
      timezone: 'UTC',
    });
    mocks.workflowUpdate.mockResolvedValue({ id: 'workflow-1', name: 'Weekly', nextRunAt: null });
  });

  it('ignores a timezone sent by the client and schedules in the workspace zone', async () => {
    await updateWorkflowAction('demo', 'workflow-1', {
      scheduleHour: 9,
      timezone: 'Asia/Tokyo',
    } as never);

    const [{ data }] = mocks.workflowUpdate.mock.calls[0];
    expect(data).not.toHaveProperty('scheduleWeekdays');
    expect(data.timezone).toBe('Europe/Bucharest');
    // 09:00 in Bucharest is 06:00 UTC, so neither the stored UTC nor Tokyo won.
    expect(data.nextRunAt.getUTCHours()).toBe(6);
  });
});

describe('updateNodeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspace.mockResolvedValue({
      workspace: { id: 'workspace-1' },
      user: { id: 'user-1' },
    });
  });

  it('returns a friendly validation error when publish has no channels', async () => {
    mocks.nodeFindFirst.mockResolvedValue({
      id: 'node-1',
      type: 'PUBLISH',
      name: 'Publish clip',
      config: {},
      workflowId: 'workflow-1',
    });

    try {
      await updateNodeAction('demo', 'node-1', {
        config: { caption: 'Hello', mode: 'queue', requireApproval: true },
      });
      expect.unreachable('Expected updateNodeAction to reject publish without channels');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).toBe('Choose at least one channel.');
      expect((error as AppError).fields).toEqual({
        socialAccountIds: ['Choose at least one channel.'],
      });
    }

    expect(mocks.nodeUpdate).not.toHaveBeenCalled();
  });

  it('persists publish config when at least one channel is selected', async () => {
    mocks.nodeFindFirst.mockResolvedValue({
      id: 'node-1',
      type: 'PUBLISH',
      name: 'Publish clip',
      config: {},
      workflowId: 'workflow-1',
    });
    mocks.nodeUpdate.mockResolvedValue({
      id: 'node-1',
      type: 'PUBLISH',
      name: 'Publish clip',
      config: {
        socialAccountIds: ['11111111-1111-4111-8111-111111111111'],
        caption: 'Hello',
        mode: 'queue',
        requireApproval: true,
      },
    });

    await updateNodeAction('demo', 'node-1', {
      config: {
        socialAccountIds: ['11111111-1111-4111-8111-111111111111'],
        caption: 'Hello',
        mode: 'queue',
        requireApproval: true,
      },
    });

    expect(mocks.nodeUpdate).toHaveBeenCalledWith({
      where: { id: 'node-1' },
      data: expect.objectContaining({
        config: expect.objectContaining({
          socialAccountIds: ['11111111-1111-4111-8111-111111111111'],
        }),
        version: { increment: 1 },
      }),
    });
  });
});

describe('workflow management actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspace.mockResolvedValue({
      workspace: { id: 'workspace-1', timezone: 'UTC' },
      user: { id: 'user-1' },
    });
  });

  it('duplicates the graph with new node ids and scheduling disabled', async () => {
    mocks.workflowFindFirst.mockResolvedValue({
      id: 'workflow-1',
      name: 'Weekly reel',
      description: 'A workflow',
      viewport: {},
      scheduleWeekdays: [1],
      scheduleHour: 9,
      scheduleMinute: 0,
      nodes: [
        { id: 'node-a', type: 'MEDIA_LIBRARY', name: 'Library', config: {}, positionX: 0, positionY: 0, version: 1 },
        { id: 'node-b', type: 'PICK', name: 'Select', config: {}, positionX: 200, positionY: 0, version: 1 },
      ],
      edges: [{
        sourceNodeId: 'node-a',
        sourcePort: 'images',
        targetNodeId: 'node-b',
        targetPort: 'items',
      }],
    });
    mocks.workflowCreate.mockResolvedValue({ id: 'workflow-copy', name: 'Weekly reel copy' });
    mocks.transaction.mockImplementation(async (callback) => callback({
      workflow: { create: mocks.workflowCreate },
      workflowNode: { createMany: mocks.nodeCreateMany },
      workflowEdge: { createMany: mocks.edgeCreateMany },
    }));

    await expect(duplicateWorkflowAction('demo', 'workflow-1')).resolves.toEqual({
      id: 'workflow-copy',
      name: 'Weekly reel copy',
    });
    expect(mocks.workflowCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ enabled: false, scheduleEnabled: false, nextRunAt: null }),
    }));
    const copiedNodes = mocks.nodeCreateMany.mock.calls[0][0].data;
    const copiedEdge = mocks.edgeCreateMany.mock.calls[0][0].data[0];
    expect(copiedEdge.sourceNodeId).toBe(copiedNodes[0].id);
    expect(copiedEdge.targetNodeId).toBe(copiedNodes[1].id);
  });

  it('archives and restores without silently enabling its schedule', async () => {
    mocks.workflowFindFirst.mockResolvedValue({ id: 'workflow-1' });
    mocks.workflowUpdate.mockResolvedValue({ id: 'workflow-1', archivedAt: new Date() });

    await setWorkflowArchivedAction('demo', 'workflow-1', true);

    expect(mocks.workflowUpdate).toHaveBeenCalledWith({
      where: { id: 'workflow-1' },
      data: expect.objectContaining({
        enabled: false,
        scheduleEnabled: false,
        nextRunAt: null,
      }),
      select: { id: true, archivedAt: true },
    });
  });

  it('requires archive and no active run before permanent deletion', async () => {
    mocks.workflowFindFirst.mockResolvedValue({ id: 'workflow-1', archivedAt: null });
    await expect(deleteWorkflowAction('demo', 'workflow-1')).rejects.toThrow('Archive this workflow');

    mocks.workflowFindFirst.mockResolvedValue({ id: 'workflow-1', archivedAt: new Date() });
    mocks.workflowRunCount.mockResolvedValue(1);
    await expect(deleteWorkflowAction('demo', 'workflow-1')).rejects.toThrow('active run');

    mocks.workflowRunCount.mockResolvedValue(0);
    await deleteWorkflowAction('demo', 'workflow-1');
    expect(mocks.workflowDelete).toHaveBeenCalledWith({ where: { id: 'workflow-1' } });
  });
});

describe('getWorkflowTrimPreviewAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspace.mockResolvedValue({
      workspace: { id: 'workspace-1' },
      user: { id: 'user-1' },
    });
    mocks.nodeFindFirst.mockResolvedValue({ workflowId: 'workflow-1' });
    mocks.mediaFolderFindMany.mockResolvedValue([]);
    mocks.mediaAssetFindMany.mockResolvedValue([{ id: 'audio-1' }, { id: 'audio-2' }]);
    mocks.mediaAssetFindFirst.mockResolvedValue({
      id: 'audio-2',
      type: 'AUDIO',
      filename: 'second-track.mp3',
      duration: 30,
      storageKey: 'audio/key',
      thumbnailKey: null,
    });
    mocks.signedUrl.mockResolvedValue('https://example.test/signed-audio');
  });

  it('resolves an indexed library selection without persisting its signed URL', async () => {
    mocks.workflowFindFirst.mockResolvedValue({
      nodes: [
        {
          id: 'library',
          type: 'MEDIA_LIBRARY',
          config: { folderId: null, includeSubfolders: true },
        },
        {
          id: 'pick',
          type: 'PICK',
          config: { mode: 'index', count: 1, index: 1 },
        },
        { id: 'trim', type: 'AUDIO_TRIMMER', config: {} },
      ],
      edges: [
        {
          sourceNodeId: 'library',
          sourcePort: 'audio',
          targetNodeId: 'pick',
          targetPort: 'items',
        },
        {
          sourceNodeId: 'pick',
          sourcePort: 'item',
          targetNodeId: 'trim',
          targetPort: 'audio',
        },
      ],
    });

    await expect(getWorkflowTrimPreviewAction('demo', 'trim')).resolves.toEqual({
      state: 'ready',
      asset: {
        id: 'audio-2',
        type: 'AUDIO',
        filename: 'second-track.mp3',
        duration: 30,
        url: 'https://example.test/signed-audio',
        posterUrl: null,
      },
    });
    expect(mocks.mediaAssetFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'audio-2', workspaceId: 'workspace-1' }),
    }));
    expect(mocks.signedUrl).toHaveBeenCalledWith('audio/key', 3600);
  });

  it('does not resolve a random selection before its run', async () => {
    mocks.workflowFindFirst.mockResolvedValue({
      nodes: [
        { id: 'pick', type: 'PICK', config: { mode: 'random', count: 1, index: 0 } },
        { id: 'trim', type: 'AUDIO_TRIMMER', config: {} },
      ],
      edges: [{
        sourceNodeId: 'pick',
        sourcePort: 'item',
        targetNodeId: 'trim',
        targetPort: 'audio',
      }],
    });

    await expect(getWorkflowTrimPreviewAction('demo', 'trim')).resolves.toMatchObject({
      state: 'unavailable',
      reason: expect.stringMatching(/random or generated/i),
    });
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });
});
